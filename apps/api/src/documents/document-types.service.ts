import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

/**
 * Document types are HR-managed reference data. HR can add a new one at
 * any time and it appears immediately on every employee's file tab.
 *
 * Types are never hard-deleted once files exist against them — an upload
 * from two years ago must keep the label it was filed under. Deactivating
 * hides it from new uploads while leaving history intact.
 */
@Injectable()
export class DocumentTypesService {
  constructor(private prisma: PrismaService) {}

  findAll(includeInactive = false) {
    return this.prisma.documentType.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
      include: { _count: { select: { documents: true } } },
    });
  }

  /** Derives a stable code from the name, e.g. "Offer Letter" -> OFFER_LETTER. */
  private async deriveCode(name: string): Promise<string> {
    const base = name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'DOCUMENT';

    let code = base;
    let suffix = 2;
    while (await this.prisma.documentType.findUnique({ where: { code } })) {
      code = `${base}_${suffix++}`;
    }
    return code;
  }

  async create(data: {
    name: string;
    category: string;
    description?: string;
    required?: boolean;
    allowMultiple?: boolean;
  }, actorId: string) {
    const clash = await this.prisma.documentType.findFirst({
      where: { name: { equals: data.name.trim(), mode: 'insensitive' } },
    });
    if (clash) {
      throw new ConflictException(`A document type named "${data.name}" already exists.`);
    }

    const last = await this.prisma.documentType.findFirst({
      where: { category: data.category as never },
      orderBy: { sortOrder: 'desc' },
    });

    const created = await this.prisma.documentType.create({
      data: {
        code: await this.deriveCode(data.name),
        name: data.name.trim(),
        category: data.category as never,
        description: data.description?.trim() || null,
        required: data.required ?? true,
        allowMultiple: data.allowMultiple ?? false,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId, action: 'created', entityType: 'DocumentType',
        entityId: created.id, after: { name: created.name, category: created.category } as never,
      },
    });

    return created;
  }

  async update(id: string, data: {
    name?: string;
    description?: string;
    required?: boolean;
    allowMultiple?: boolean;
    isActive?: boolean;
    sortOrder?: number;
  }, actorId: string) {
    const before = await this.prisma.documentType.findUniqueOrThrow({ where: { id } });

    if (data.name && data.name.trim() !== before.name) {
      const clash = await this.prisma.documentType.findFirst({
        where: { name: { equals: data.name.trim(), mode: 'insensitive' }, id: { not: id } },
      });
      if (clash) throw new ConflictException(`A document type named "${data.name}" already exists.`);
    }

    const updated = await this.prisma.documentType.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        description: data.description?.trim() ?? undefined,
        required: data.required,
        allowMultiple: data.allowMultiple,
        isActive: data.isActive,
        sortOrder: data.sortOrder,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId, action: 'updated', entityType: 'DocumentType', entityId: id,
        before: { name: before.name, isActive: before.isActive } as never,
        after: { name: updated.name, isActive: updated.isActive } as never,
      },
    });

    return updated;
  }

  /**
   * Only removable while unused. Once a file has been filed against a type,
   * deleting it would orphan that upload — deactivate instead.
   */
  async remove(id: string, actorId: string) {
    const type = await this.prisma.documentType.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { documents: true } } },
    });

    if (type._count.documents > 0) {
      throw new BadRequestException(
        `"${type.name}" has ${type._count.documents} uploaded file(s). ` +
          `Deactivate it instead — deleting would orphan those documents.`,
      );
    }

    await this.prisma.documentType.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: {
        actorId, action: 'deleted', entityType: 'DocumentType', entityId: id,
        before: { name: type.name } as never,
      },
    });
    return { ok: true };
  }
}