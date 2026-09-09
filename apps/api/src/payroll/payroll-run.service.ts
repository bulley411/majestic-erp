import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import Decimal from 'decimal.js';
import {
  computePayslip, summarise, computeDeduction, isoDate,
  type SalaryStructure, type TaxBand, type DayRecord, type AttendanceStatus,
} from '@mapa/shared';
import { authorizeTransition, availableActions, type Actor } from './payroll-approval';
import type { ApprovalAction } from '@prisma/client';

@Injectable()
export class PayrollRunService {
  constructor(
    private prisma: PrismaService,
    private attendance: AttendanceService,
  ) {}

  /* --------------------------- reference data ---------------------- */

  /** Salary structure in the engine's shape. */
  private async structure(id: string): Promise<SalaryStructure> {
    const row = await this.prisma.salaryStructure.findUniqueOrThrow({
      where: { id },
      include: { components: { orderBy: { sortOrder: 'asc' } } },
    });
    return {
      code: row.code,
      name: row.name,
      components: row.components.map((c) => ({
        code: c.code,
        name: c.name,
        ratio: new Decimal(c.ratio.toString()),
        pensionable: c.pensionable,
      })),
    };
  }

  /**
   * Tax bands for a year, falling back to the most recent set defined.
   * A run must never silently use no bands and produce zero PAYE.
   */
  private async bands(year: number): Promise<TaxBand[]> {
    let rows = await this.prisma.taxBand.findMany({
      where: { effectiveYear: year },
      orderBy: { sortOrder: 'asc' },
    });

    if (!rows.length) {
      const latest = await this.prisma.taxBand.findFirst({
        where: { effectiveYear: { lte: year } },
        orderBy: { effectiveYear: 'desc' },
      });
      if (!latest) {
        throw new BadRequestException(
          `No PAYE bands are defined for ${year}. Run the reference seed first.`,
        );
      }
      rows = await this.prisma.taxBand.findMany({
        where: { effectiveYear: latest.effectiveYear },
        orderBy: { sortOrder: 'asc' },
      });
    }

    return rows.map((b) => ({
      width: b.width === null ? null : new Decimal(b.width.toString()),
      rate: new Decimal(b.rate.toString()),
    }));
  }

  /* ------------------------------- runs ---------------------------- */

  list() {
    return this.prisma.payrollRun.findMany({
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
      include: { _count: { select: { payslips: true } } },
    });
  }

  async findOne(id: string, actor: Actor) {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({
      where: { id },
      include: {
        payslips: {
          include: {
            employee: {
              select: {
                id: true, staffId: true, firstName: true, lastName: true,
                bankName: true, bankAccountNumber: true,
                department: { select: { name: true } },
              },
            },
          },
          orderBy: { employee: { staffId: 'asc' } },
        },
        approvals: { orderBy: { createdAt: 'asc' } },
      },
    });

    return {
      ...run,
      availableActions: availableActions(run, actor),
    };
  }

  /**
   * Builds a run for a period.
   *
   * Payslips are computed from the compensation effective on the last day
   * of the period, not whatever is current — so re-running a past month
   * reproduces the same figures even after someone has had a raise since.
   */
  async create(year: number, month: number, actorId: string) {
    if (month < 1 || month > 12) throw new BadRequestException('Invalid month.');

    const existing = await this.prisma.payrollRun.findUnique({
      where: { periodYear_periodMonth: { periodYear: year, periodMonth: month } },
    });
    if (existing) {
      throw new ConflictException(
        `A payroll run for ${month}/${year} already exists (${existing.status}).`,
      );
    }

    const periodEnd = new Date(Date.UTC(year, month, 0));
    const periodStart = new Date(Date.UTC(year, month - 1, 1));

    const employees = await this.prisma.employee.findMany({
      where: {
        status: { in: ['ACTIVE', 'ON_LEAVE'] },
        // Payroll activates from the assumption of duty date, per your
        // Assumption of Duty Form.
        OR: [
          { dateOfAssumption: { lte: periodEnd } },
          { dateOfAssumption: null, dateOfEmployment: { lte: periodEnd } },
        ],
      },
      include: {
        compensations: {
          where: { effectiveFrom: { lte: periodEnd } },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
      orderBy: { staffId: 'asc' },
    });

    if (!employees.length) {
      throw new BadRequestException('No active employees are eligible for this period.');
    }

    const withoutSalary = employees.filter((e) => !e.compensations.length);
    if (withoutSalary.length) {
      throw new BadRequestException(
        `No salary recorded for: ${withoutSalary
          .map((e) => `${e.firstName} ${e.lastName} (${e.staffId})`)
          .join(', ')}. Set it on their Salary tab first.`,
      );
    }

    const policy = await this.attendance.policy();
    const holidayRows = await this.attendance.holidays(year);
    const holidays = new Set(holidayRows.map((h) => isoDate(h.date)));
    const bands = await this.bands(year);

    const records = await this.prisma.attendanceRecord.findMany({
      where: { date: { gte: periodStart, lte: periodEnd } },
    });
    const attendanceByEmployee = new Map<string, DayRecord[]>();
    for (const r of records) {
      const list = attendanceByEmployee.get(r.employeeId) ?? [];
      list.push({
        date: isoDate(r.date),
        status: r.status as AttendanceStatus,
        minutesLate: r.minutesLate,
      });
      attendanceByEmployee.set(r.employeeId, list);
    }

    const rows: Array<Record<string, unknown>> = [];
    let totalGross = new Decimal(0);
    let totalNet = new Decimal(0);
    let totalPaye = new Decimal(0);
    let totalPensionEmployee = new Decimal(0);
    let totalPensionEmployer = new Decimal(0);

    for (const employee of employees) {
      const comp = employee.compensations[0];
      const structure = await this.structure(comp.structureId);
      const contracted = new Decimal(comp.monthlyGross.toString());

      const summary = summarise(
        year, month, attendanceByEmployee.get(employee.id) ?? [], policy, holidays,
      );
      const deduction = computeDeduction(
        contracted, summary, year, month, policy, holidays,
      );

      // The engine works from earned gross, so PAYE and pension follow
      // what was actually earned rather than the contracted figure.
      const slip = computePayslip({
        monthlyGross: deduction.adjustedGross,
        structure,
        annualRentPaid: employee.annualRentPaid
          ? new Decimal(employee.annualRentPaid.toString())
          : new Decimal(0),
        nhfEnrolled: employee.nhfEnrolled,
        bands,
      });

      const components = slip.components;

      rows.push({
        employeeId: employee.id,
        contractedGross: contracted.toFixed(4),
        monthlyGross: slip.monthlyGross.toFixed(4),
        workingDays: summary.workingDays,
        daysAbsent: new Decimal(summary.daysAbsent).toFixed(2),
        daysForfeited: summary.daysForfeited.toFixed(2),
        attendanceDeduction: deduction.amount.toFixed(4),
        basicSalary: (components['BASIC'] ?? new Decimal(0)).toFixed(4),
        housingAllowance: (components['HOUSING'] ?? new Decimal(0)).toFixed(4),
        transportAllowance: (components['TRANSPORT'] ?? new Decimal(0)).toFixed(4),
        utilityAllowance: (components['UTILITY'] ?? new Decimal(0)).toFixed(4),
        mealAllowance: (components['MEAL'] ?? new Decimal(0)).toFixed(4),
        paye: slip.payeMonthly.toFixed(4),
        pensionEmployee: slip.pensionEmployee.toFixed(4),
        pensionEmployer: slip.pensionEmployer.toFixed(4),
        nhf: slip.nhf.toFixed(4),
        totalDeductions: slip.totalDeductions.toFixed(4),
        netPay: slip.netPay.toFixed(4),
        peculiarAllowance: comp.peculiarAllowance.toString(),
        // Everything needed to explain this payslip later, even if the
        // policy, bands or salary change afterwards.
        computationSnapshot: {
          structure: structure.code,
          policy,
          deductionBasis: deduction.basis,
          dailyRate: deduction.dailyRate.toFixed(4),
          annualRentPaid: employee.annualRentPaid?.toString() ?? '0',
          rentRelief: slip.rentRelief.toFixed(4),
          annualTaxableIncome: slip.annualTaxableIncome.toFixed(4),
          payeAnnual: slip.payeAnnual.toFixed(4),
          attendance: {
            workingDays: summary.workingDays,
            present: summary.daysPresent,
            remote: summary.daysRemote,
            late: summary.daysLate,
            half: summary.daysHalf,
            absent: summary.daysAbsent,
            onLeave: summary.daysOnLeave,
            unmarked: summary.daysUnmarked,
          },
        },
      });

      totalGross = totalGross.plus(slip.monthlyGross);
      totalNet = totalNet.plus(slip.netPay);
      totalPaye = totalPaye.plus(slip.payeMonthly);
      totalPensionEmployee = totalPensionEmployee.plus(slip.pensionEmployee);
      totalPensionEmployer = totalPensionEmployer.plus(slip.pensionEmployer);
    }

    const reference = `MAPA/PAY/${year}/${String(month).padStart(2, '0')}`;

    return this.prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.create({
        data: {
          reference,
          periodYear: year,
          periodMonth: month,
          status: 'DRAFT',
          preparedById: actorId,
          totalGross: totalGross.toFixed(4),
          totalNet: totalNet.toFixed(4),
          totalPaye: totalPaye.toFixed(4),
          totalPensionEmployee: totalPensionEmployee.toFixed(4),
          totalPensionEmployer: totalPensionEmployer.toFixed(4),
          payslips: { create: rows as never },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: 'payroll.created',
          entityType: 'PayrollRun',
          entityId: run.id,
          after: { reference, employees: rows.length, totalNet: totalNet.toFixed(2) } as never,
        },
      });

      return run;
    });
  }

  /** Discards a draft and unlocks its attendance. */
  async discard(id: string, actorId: string) {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({ where: { id } });
    if (run.status !== 'DRAFT' && run.status !== 'REJECTED') {
      throw new BadRequestException(
        `Only a draft or rejected run can be discarded. This one is ${run.status}.`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.attendanceRecord.updateMany({
        where: { lockedByRunId: id },
        data: { lockedByRunId: null },
      }),
      this.prisma.payrollRun.delete({ where: { id } }),
      this.prisma.auditLog.create({
        data: {
          actorId, action: 'payroll.discarded', entityType: 'PayrollRun',
          entityId: id, before: { reference: run.reference } as never,
        },
      }),
    ]);

    return { ok: true };
  }

  /* ---------------------------- approvals -------------------------- */

  /**
   * Moves a run through the chain. The guard in payroll-approval.ts
   * enforces who may act and that nobody signs the same run twice.
   */
  async transition(
    id: string,
    action: ApprovalAction,
    actor: Actor,
    remarks?: string,
  ) {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({ where: { id } });
    const { to, records, role } = authorizeTransition(run, action, actor, remarks);

    const stamps: Record<string, unknown> = { status: to };
    if (records === 'preparedById') { stamps.preparedById = actor.id; stamps.preparedAt = new Date(); }
    if (records === 'reviewedById') { stamps.reviewedById = actor.id; stamps.reviewedAt = new Date(); }
    if (records === 'approvedById') { stamps.approvedById = actor.id; stamps.approvedAt = new Date(); }
    if (action === 'REJECT') stamps.rejectionReason = remarks;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payrollRun.update({ where: { id }, data: stamps as never });

      await tx.payrollApproval.create({
        data: {
          runId: id,
          action,
          fromStatus: run.status,
          toStatus: to,
          actorId: actor.id,
          actorRole: role,
          remarks,
        },
      });

      // Once the Head of Finance has signed, the attendance behind these
      // figures is frozen. Editing it afterwards would leave an approved
      // payslip that no longer reconciles with the register.
      if (to === 'REVIEWED') {
        const start = new Date(Date.UTC(run.periodYear, run.periodMonth - 1, 1));
        const end = new Date(Date.UTC(run.periodYear, run.periodMonth, 0));
        await tx.attendanceRecord.updateMany({
          where: { date: { gte: start, lte: end }, lockedByRunId: null },
          data: { lockedByRunId: id },
        });
      }

      // A rejection sends it back for rework, so the register reopens.
      if (to === 'REJECTED') {
        await tx.attendanceRecord.updateMany({
          where: { lockedByRunId: id },
          data: { lockedByRunId: null },
        });
      }

      return updated;
    });
  }

  /** Bank transfer schedule for an approved run. */
  async paymentSchedule(id: string) {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({
      where: { id },
      include: {
        payslips: {
          include: {
            employee: {
              select: {
                staffId: true, firstName: true, lastName: true,
                bankName: true, bankAccountName: true, bankAccountNumber: true,
              },
            },
          },
          orderBy: { employee: { staffId: 'asc' } },
        },
      },
    });

    const missing = run.payslips
      .filter((p) => !p.employee.bankAccountNumber || !p.employee.bankName)
      .map((p) => `${p.employee.firstName} ${p.employee.lastName}`);

    return {
      reference: run.reference,
      status: run.status,
      totalNet: run.totalNet.toString(),
      missingBankDetails: missing,
      lines: run.payslips.map((p) => ({
        staffId: p.employee.staffId,
        name: `${p.employee.firstName} ${p.employee.lastName}`,
        bankName: p.employee.bankName,
        accountName: p.employee.bankAccountName,
        accountNumber: p.employee.bankAccountNumber,
        amount: p.netPay.toString(),
        peculiarAllowance: p.peculiarAllowance.toString(),
      })),
    };
  }
}