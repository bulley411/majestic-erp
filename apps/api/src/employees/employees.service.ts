import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Directory listing. Includes file completeness, since that is what the
   * card view leads with and computing it per-card in the browser would
   * mean one request per employee.
   */
  async findAll(params: { search?: string; departmentId?: string } = {}) {
    const employees = await this.prisma.employee.findMany({
      where: {
        departmentId: params.departmentId,
        OR: params.search
          ? [
              { firstName: { contains: params.search, mode: 'insensitive' } },
              { lastName: { contains: params.search, mode: 'insensitive' } },
              { staffId: { contains: params.search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      include: {
        department: true,
        jobTitle: true,
        gradeLevel: true,
        documents: { where: { onFile: true }, include: { documentType: true } },
        compensations: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
      },
      orderBy: { staffId: 'asc' },
    });

    const types = await this.prisma.documentType.findMany();
    const byCategory = (c: string) => types.filter((t) => t.category === c).length;
    const totals = {
      PRE_EMPLOYMENT: byCategory('PRE_EMPLOYMENT'),
      ONBOARDING: byCategory('ONBOARDING'),
      LIFECYCLE: byCategory('LIFECYCLE'),
      EXIT: byCategory('EXIT'),
    };

    return employees.map((e) => {
      const held = (c: string) =>
        e.documents.filter((d) => d.documentType.category === c).length;
      return {
        ...e,
        documents: undefined,
        currentGross: e.compensations[0]?.monthlyGross ?? null,
        fileCompleteness: {
          totals,
          held: {
            PRE_EMPLOYMENT: held('PRE_EMPLOYMENT'),
            ONBOARDING: held('ONBOARDING'),
            LIFECYCLE: held('LIFECYCLE'),
            EXIT: held('EXIT'),
          },
          // Exit records are not applicable while an employee is serving.
          applicable:
            totals.PRE_EMPLOYMENT + totals.ONBOARDING + totals.LIFECYCLE +
            (e.status === 'EXITED' ? totals.EXIT : 0),
        },
      };
    });
  }

  findOne(id: string) {
    return this.prisma.employee.findUniqueOrThrow({
      where: { id },
      include: {
        department: true, jobTitle: true, gradeLevel: true, supervisor: true,
        documents: { include: { documentType: true } },
        compensations: { orderBy: { effectiveFrom: 'desc' } },
      },
    });
  }
}
