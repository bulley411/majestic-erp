import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

/**
 * Departments, job titles and grade levels — HR-managed reference data.
 *
 * None of these are hard-deleted while employees reference them; that
 * would leave records pointing at nothing. Deactivating hides them from
 * new assignments while existing employees keep their label.
 */
@Injectable()
export class OrgService {
  constructor(private prisma: PrismaService) {}

  /* ------------------------- departments ------------------------- */

  departments(includeInactive = false) {
    return this.prisma.department.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: true } } },
    });
  }

  async createDepartment(data: { code: string; name: string }, actorId: string) {
    const clash = await this.prisma.department.findFirst({
      where: { OR: [{ code: data.code }, { name: { equals: data.name, mode: 'insensitive' } }] },
    });
    if (clash) throw new ConflictException(`"${data.name}" or code ${data.code} already exists.`);

    const created = await this.prisma.department.create({ data });
    await this.log(actorId, 'created', 'Department', created.id, { name: created.name });
    return created;
  }

  async updateDepartment(
    id: string,
    data: { code?: string; name?: string; isActive?: boolean },
    actorId: string,
  ) {
    const before = await this.prisma.department.findUniqueOrThrow({ where: { id } });
    if (data.code && data.code !== before.code) {
      const clash = await this.prisma.department.findFirst({
        where: { code: data.code, id: { not: id } },
      });
      if (clash) throw new ConflictException(`Code ${data.code} is already in use.`);
    }
    const updated = await this.prisma.department.update({ where: { id }, data });
    await this.log(actorId, 'updated', 'Department', id, { name: updated.name });
    return updated;
  }

  async removeDepartment(id: string, actorId: string) {
    const dept = await this.prisma.department.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { employees: true } } },
    });
    if (dept._count.employees > 0) {
      throw new BadRequestException(
        `${dept._count.employees} employee(s) are in "${dept.name}". ` +
          `Move them first, or deactivate the department instead.`,
      );
    }
    await this.prisma.department.delete({ where: { id } });
    await this.log(actorId, 'deleted', 'Department', id, { name: dept.name });
    return { ok: true };
  }

  /* ------------------------- job titles -------------------------- */

  jobTitles(includeInactive = false) {
    return this.prisma.jobTitle.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: true } } },
    });
  }

  async createJobTitle(data: { name: string }, actorId: string) {
    const clash = await this.prisma.jobTitle.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' } },
    });
    if (clash) throw new ConflictException(`"${data.name}" already exists.`);
    const created = await this.prisma.jobTitle.create({ data });
    await this.log(actorId, 'created', 'JobTitle', created.id, { name: created.name });
    return created;
  }

  async updateJobTitle(
    id: string,
    data: { name?: string; isActive?: boolean },
    actorId: string,
  ) {
    if (data.name) {
      const clash = await this.prisma.jobTitle.findFirst({
        where: { name: { equals: data.name, mode: 'insensitive' }, id: { not: id } },
      });
      if (clash) throw new ConflictException(`"${data.name}" already exists.`);
    }
    const updated = await this.prisma.jobTitle.update({ where: { id }, data });
    await this.log(actorId, 'updated', 'JobTitle', id, { name: updated.name });
    return updated;
  }

  async removeJobTitle(id: string, actorId: string) {
    const title = await this.prisma.jobTitle.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { employees: true } } },
    });
    if (title._count.employees > 0) {
      throw new BadRequestException(
        `${title._count.employees} employee(s) hold "${title.name}". Deactivate it instead.`,
      );
    }
    await this.prisma.jobTitle.delete({ where: { id } });
    await this.log(actorId, 'deleted', 'JobTitle', id, { name: title.name });
    return { ok: true };
  }

  /* ------------------------ grade levels ------------------------- */

  gradeLevels(includeInactive = false) {
    return this.prisma.gradeLevel.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { rank: 'desc' },
      include: { _count: { select: { employees: true } } },
    });
  }

  async createGradeLevel(
    data: { code: string; name: string; rank: number; defaultGross?: number },
    actorId: string,
  ) {
    const clash = await this.prisma.gradeLevel.findUnique({ where: { code: data.code } });
    if (clash) throw new ConflictException(`Grade ${data.code} already exists.`);
    const created = await this.prisma.gradeLevel.create({
      data: {
        code: data.code,
        name: data.name,
        rank: data.rank,
        defaultGross: data.defaultGross?.toString(),
      },
    });
    await this.log(actorId, 'created', 'GradeLevel', created.id, { code: created.code });
    return created;
  }

  async updateGradeLevel(
    id: string,
    data: { code?: string; name?: string; rank?: number; defaultGross?: number; isActive?: boolean },
    actorId: string,
  ) {
    const before = await this.prisma.gradeLevel.findUniqueOrThrow({ where: { id } });
    if (data.code && data.code !== before.code) {
      const clash = await this.prisma.gradeLevel.findFirst({
        where: { code: data.code, id: { not: id } },
      });
      if (clash) throw new ConflictException(`Grade ${data.code} already exists.`);
    }
    const updated = await this.prisma.gradeLevel.update({
      where: { id },
      data: {
        code: data.code,
        name: data.name,
        rank: data.rank,
        defaultGross: data.defaultGross?.toString(),
        isActive: data.isActive,
      },
    });
    await this.log(actorId, 'updated', 'GradeLevel', id, { code: updated.code });
    return updated;
  }

  async removeGradeLevel(id: string, actorId: string) {
    const grade = await this.prisma.gradeLevel.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { employees: true } } },
    });
    if (grade._count.employees > 0) {
      throw new BadRequestException(
        `${grade._count.employees} employee(s) are on ${grade.code}. Deactivate it instead.`,
      );
    }
    await this.prisma.gradeLevel.delete({ where: { id } });
    await this.log(actorId, 'deleted', 'GradeLevel', id, { code: grade.code });
    return { ok: true };
  }

  private log(
    actorId: string, action: string, entityType: string,
    entityId: string, after: Record<string, unknown>,
  ) {
    return this.prisma.auditLog.create({
      data: { actorId, action, entityType, entityId, after: after as never },
    });
  }
}