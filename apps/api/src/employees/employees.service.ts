import {
  Injectable, BadRequestException, ConflictException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import type { EmployeeCreate, EmployeeUpdate } from '@mapa/shared';
import {
  validateFile, saveFile, readStoredFile, deleteStoredFile, FileRejected,
  MAX_PHOTO_BYTES, PHOTO_MIME_TYPES,
} from '../documents/storage';



/** Fields never written to the audit log in clear. */
const SENSITIVE_FIELDS = new Set([
  'bankAccountNumber',
  'rsaPin',
  'taxIdentificationNumber',
  'nhfNumber',
]);

const mask = (value: unknown) => {
  if (typeof value !== 'string' || value.length < 4) return '****';
  return '*'.repeat(value.length - 4) + value.slice(-4);
};

/**
 * Redacts sensitive values so the audit trail records that a field changed
 * without copying the secret into a second table. An audit log is usually
 * readable by more people than the record it describes.
 */
function redact(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = SENSITIVE_FIELDS.has(k) && v != null ? mask(v) : v;
  }
  return out;
}

@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService) {}

  async findAll(params: { search?: string; departmentId?: string; status?: string } = {}) {
    const employees = await this.prisma.employee.findMany({
      where: {
        departmentId: params.departmentId,
        status: params.status as never,
        OR: params.search
          ? [
              { firstName: { contains: params.search, mode: 'insensitive' } },
              { lastName: { contains: params.search, mode: 'insensitive' } },
              { staffId: { contains: params.search, mode: 'insensitive' } },
              { rsaPin: { contains: params.search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      include: {
        department: true,
        jobTitle: true,
        gradeLevel: true,
        documents: { include: { documentType: true } },
        compensations: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
      },
      orderBy: { staffId: 'asc' },
    });

    const types = await this.prisma.documentType.findMany({ where: { isActive: true } });
    const count = (c: string) => types.filter((t) => t.category === c).length;
    const totals = {
      PRE_EMPLOYMENT: count('PRE_EMPLOYMENT'),
      ONBOARDING: count('ONBOARDING'),
      LIFECYCLE: count('LIFECYCLE'),
      EXIT: count('EXIT'),
    };

    return employees.map((e) => {
      // A type counts as held once at least one file exists for it.
      const heldTypes = new Set(e.documents.map((d) => d.documentTypeId));
      const held = (c: string) =>
        types.filter((t) => t.category === c && heldTypes.has(t.id)).length;

      return {
        ...e,
        hasPhoto: !!e.photoUrl,
        photoUrl: undefined,
        documents: undefined,
        currentGross: e.compensations[0]?.monthlyGross ?? null,
        compensations: undefined,
        fileCompleteness: {
          totals,
          held: {
            PRE_EMPLOYMENT: held('PRE_EMPLOYMENT'),
            ONBOARDING: held('ONBOARDING'),
            LIFECYCLE: held('LIFECYCLE'),
            EXIT: held('EXIT'),
          },
          applicable:
            totals.PRE_EMPLOYMENT +
            totals.ONBOARDING +
            totals.LIFECYCLE +
            (e.status === 'EXITED' ? totals.EXIT : 0),
        },
      };
    });
  }

  findOne(id: string) {
    return this.prisma.employee.findUniqueOrThrow({
      where: { id },
      include: {
        department: true,
        jobTitle: true,
        gradeLevel: true,
        supervisor: {
          select: { id: true, firstName: true, lastName: true, staffId: true },
        },
        compensations: {
          orderBy: { effectiveFrom: 'desc' },
          include: { structure: true },
        },
      },
    });
  }

  /** Reference data for the form's select inputs. */
  async formOptions() {
    const [departments, jobTitles, gradeLevels, supervisors, banks, structures] =
      await Promise.all([
        this.prisma.department.findMany({ orderBy: { name: 'asc' } }),
        this.prisma.jobTitle.findMany({ orderBy: { name: 'asc' } }),
        this.prisma.gradeLevel.findMany({ orderBy: { rank: 'desc' } }),
        this.prisma.employee.findMany({
          where: { status: { in: ['ACTIVE', 'ON_LEAVE'] } },
          select: { id: true, firstName: true, lastName: true, staffId: true },
          orderBy: { firstName: 'asc' },
        }),
        this.prisma.bank.findMany({ orderBy: { name: 'asc' } }),
        this.prisma.salaryStructure.findMany({ where: { isActive: true } }),
      ]);
    return { departments, jobTitles, gradeLevels, supervisors, banks, structures };
  }

  async create(data: EmployeeCreate, actorId: string, ip?: string) {
    const existing = await this.prisma.employee.findUnique({
      where: { staffId: data.staffId },
    });
    if (existing) {
      throw new ConflictException(`Staff ID ${data.staffId} is already in use.`);
    }

    const employee = await this.prisma.employee.create({ data: data as never });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'created',
        entityType: 'Employee',
        entityId: employee.id,
        after: redact(data as Record<string, unknown>) as never,
        ipAddress: ip,
      },
    });

    return employee;
  }

  async update(id: string, data: EmployeeUpdate, actorId: string, ip?: string) {
    const before = await this.prisma.employee.findUniqueOrThrow({ where: { id } });

    if (data.staffId && data.staffId !== before.staffId) {
      const clash = await this.prisma.employee.findUnique({
        where: { staffId: data.staffId },
      });
      if (clash) {
        throw new ConflictException(`Staff ID ${data.staffId} is already in use.`);
      }
    }

    if (data.supervisorId === id) {
      throw new BadRequestException('An employee cannot be their own supervisor.');
    }

    // Walk the reporting chain to prevent a cycle. A loop here would make
    // the org chart infinite and hang any recursive query over it.
    if (data.supervisorId) {
      let cursor: string | null = data.supervisorId;
      const seen = new Set<string>([id]);
      while (cursor) {
        if (seen.has(cursor)) {
          throw new BadRequestException(
            'That reporting line creates a loop. Choose a different supervisor.',
          );
        }
        seen.add(cursor);
        const next: { supervisorId: string | null } | null =
          await this.prisma.employee.findUnique({
            where: { id: cursor },
            select: { supervisorId: true },
          });
        cursor = next?.supervisorId ?? null;
      }
    }

    const employee = await this.prisma.employee.update({
      where: { id },
      data: data as never,
    });

    // Log only what actually changed, so the trail stays readable.
    const changed: Record<string, unknown> = {};
    const previous: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      const old = (before as Record<string, unknown>)[k];
      if (String(old ?? '') !== String(v ?? '')) {
        changed[k] = v;
        previous[k] = old;
      }
    }

    if (Object.keys(changed).length) {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          action: 'updated',
          entityType: 'Employee',
          entityId: id,
          before: redact(previous) as never,
          after: redact(changed) as never,
          ipAddress: ip,
        },
      });
    }

    return employee;
  }

  /**
   * Replaces the employee's passport photograph.
   * The old file is removed, so one photo per employee rather than an
   * accumulating pile of previous versions.
   */
  async setPhoto(
    id: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    actorId: string,
  ) {
    const employee = await this.prisma.employee.findUniqueOrThrow({ where: { id } });

    try {
      validateFile(file.buffer, file.originalname, file.mimetype, {
        maxBytes: MAX_PHOTO_BYTES,
        allowedMimes: PHOTO_MIME_TYPES,
      });
    } catch (e) {
      if (e instanceof FileRejected) throw new BadRequestException(e.message);
      throw e;
    }

    const storedName = await saveFile(file.buffer, file.originalname);
    if (employee.photoUrl) await deleteStoredFile(employee.photoUrl);

    await this.prisma.employee.update({
      where: { id },
      data: { photoUrl: storedName },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId, action: 'photo.updated', entityType: 'Employee', entityId: id,
        after: { fileName: file.originalname } as never,
      },
    });

    return { ok: true };
  }

  async getPhoto(id: string) {
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { id },
      select: { photoUrl: true },
    });
    if (!employee.photoUrl) throw new NotFoundException('No photograph on file.');
    try {
      const buffer = await readStoredFile(employee.photoUrl);
      const ext = employee.photoUrl.split('.').pop();
      const mimeType =
        ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return { buffer, mimeType };
    } catch {
      throw new NotFoundException('The photograph is missing from storage.');
    }
  }

  async removePhoto(id: string, actorId: string) {
    const employee = await this.prisma.employee.findUniqueOrThrow({ where: { id } });
    if (employee.photoUrl) {
      await deleteStoredFile(employee.photoUrl);
      await this.prisma.employee.update({ where: { id }, data: { photoUrl: null } });
      await this.prisma.auditLog.create({
        data: {
          actorId, action: 'photo.removed', entityType: 'Employee', entityId: id,
        },
      });
    }
    return { ok: true };
  }
  
  /* ------------------------- compensation ------------------------- */

  compensationHistory(employeeId: string) {
    return this.prisma.employeeCompensation.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: 'desc' },
      include: { structure: true },
    });
  }

  /**
   * Records a new compensation. Never edits an existing one.
   *
   * The previous record is closed off the day before this one starts, so
   * a payroll run for any past month reads the figure that was actually
   * in force then. Editing history in place would silently rewrite old
   * payslips, which is the one thing a payroll system must never do.
   */
  async setCompensation(
    employeeId: string,
    data: {
      structureId: string;
      totalPackage: number;
      monthlyGross: number;
      peculiarAllowance: number;
      effectiveFrom: Date;
      reason?: string;
    },
    actorId: string,
  ) {
    await this.prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });

    const clash = await this.prisma.employeeCompensation.findFirst({
      where: { employeeId, effectiveFrom: data.effectiveFrom },
    });
    if (clash) {
      throw new ConflictException(
        `A compensation record already starts on ${data.effectiveFrom.toDateString()}.`,
      );
    }

    const current = await this.prisma.employeeCompensation.findFirst({
      where: { employeeId, effectiveFrom: { lt: data.effectiveFrom }, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
    });

    return this.prisma.$transaction(async (tx) => {
      if (current) {
        const dayBefore = new Date(data.effectiveFrom);
        dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
        await tx.employeeCompensation.update({
          where: { id: current.id },
          data: { effectiveTo: dayBefore },
        });
      }

      const created = await tx.employeeCompensation.create({
        data: {
          employeeId,
          structureId: data.structureId,
          totalPackage: data.totalPackage.toString(),
          monthlyGross: data.monthlyGross.toString(),
          peculiarAllowance: data.peculiarAllowance.toString(),
          effectiveFrom: data.effectiveFrom,
          reason: data.reason,
          recordedById: actorId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: 'compensation.recorded',
          entityType: 'Employee',
          entityId: employeeId,
          before: current
            ? { monthlyGross: current.monthlyGross.toString() } as never
            : undefined,
          after: {
            monthlyGross: data.monthlyGross,
            totalPackage: data.totalPackage,
            effectiveFrom: data.effectiveFrom.toISOString().slice(0, 10),
            reason: data.reason ?? null,
          } as never,
        },
      });

      return created;
    });
  }
  
  /** Change history for one employee, newest first. */
  history(employeeId: string) {
    return this.prisma.auditLog.findMany({
      where: { entityType: 'Employee', entityId: employeeId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}