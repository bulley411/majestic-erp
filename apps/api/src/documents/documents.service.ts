import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import {
  validateFile, saveFile, checksum, readStoredFile, deleteStoredFile, FileRejected,
} from './storage';

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Every active type, each with any files already filed against it.
   * Returned as one structure so the UI can render the full file in
   * order without matching two lists client-side.
   */
  async employeeFile(employeeId: string) {
    const [types, documents] = await Promise.all([
      this.prisma.documentType.findMany({
        where: { isActive: true },
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
      }),
      this.prisma.employeeDocument.findMany({
        where: { employeeId },
        include: { documentType: true },
        orderBy: { uploadedAt: 'desc' },
      }),
    ]);

    // Inactive types that still hold files must remain visible, or a
    // document would silently disappear from the employee's file.
    const inactiveWithFiles = documents
      .map((d) => d.documentType)
      .filter((t) => !t.isActive)
      .filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i);

    const all = [...types, ...inactiveWithFiles];

    return all.map((type) => ({
      type,
      files: documents
        .filter((d) => d.documentTypeId === type.id)
        .map((d) => ({
          id: d.id,
          originalName: d.originalName,
          fileSizeBytes: d.fileSizeBytes,
          mimeType: d.mimeType,
          uploadedAt: d.uploadedAt,
          remarks: d.remarks,
        })),
    }));
  }

  async upload(
    employeeId: string,
    documentTypeId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    actorId: string,
    remarks?: string,
  ) {
    const type = await this.prisma.documentType.findUniqueOrThrow({
      where: { id: documentTypeId },
    });
    await this.prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });

    try {
      validateFile(file.buffer, file.originalname, file.mimetype);
    } catch (e) {
      if (e instanceof FileRejected) throw new BadRequestException(e.message);
      throw e;
    }

    const hash = checksum(file.buffer);

    const duplicate = await this.prisma.employeeDocument.findFirst({
      where: { employeeId, documentTypeId, checksum: hash },
    });
    if (duplicate) {
      throw new BadRequestException(
        `That exact file is already filed under "${type.name}".`,
      );
    }

    const existing = await this.prisma.employeeDocument.findMany({
      where: { employeeId, documentTypeId },
    });

    // Single-file types replace rather than accumulate, so "Offer Letter"
    // holds the current one and not five near-identical drafts.
    if (!type.allowMultiple && existing.length > 0) {
      for (const old of existing) {
        await deleteStoredFile(old.storedName);
        await this.prisma.employeeDocument.delete({ where: { id: old.id } });
      }
    }

    const storedName = await saveFile(file.buffer, file.originalname);

    const record = await this.prisma.employeeDocument.create({
      data: {
        employeeId,
        documentTypeId,
        storedName,
        originalName: file.originalname.slice(0, 255),
        fileSizeBytes: file.buffer.length,
        mimeType: file.mimetype,
        checksum: hash,
        uploadedById: actorId,
        remarks: remarks?.slice(0, 500),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'document.uploaded',
        entityType: 'EmployeeDocument',
        entityId: record.id,
        after: { employeeId, documentType: type.name, fileName: record.originalName } as never,
      },
    });

    return { id: record.id, originalName: record.originalName };
  }

  async download(documentId: string) {
    const doc = await this.prisma.employeeDocument.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Document not found.');
    try {
      const buffer = await readStoredFile(doc.storedName);
      return { buffer, originalName: doc.originalName, mimeType: doc.mimeType };
    } catch {
      throw new NotFoundException(
        'The file is missing from storage. It may have been removed outside the system.',
      );
    }
  }

  async remove(documentId: string, actorId: string) {
    const doc = await this.prisma.employeeDocument.findUniqueOrThrow({
      where: { id: documentId },
      include: { documentType: true },
    });

    await deleteStoredFile(doc.storedName);
    await this.prisma.employeeDocument.delete({ where: { id: documentId } });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'document.deleted',
        entityType: 'EmployeeDocument',
        entityId: documentId,
        before: {
          employeeId: doc.employeeId,
          documentType: doc.documentType.name,
          fileName: doc.originalName,
        } as never,
      },
    });

    return { ok: true };
  }
}