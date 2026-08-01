import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import Decimal from 'decimal.js';

/**
 * Posts an approved payroll run to the general ledger.
 *
 * For July 2026 (one employee, MAPA-26-PER-0008) this produces:
 *
 *   Dr  Salaries and wages                     195,000.00
 *   Dr  Pension expense - employer              15,600.00
 *       Cr  PAYE payable                                    11,528.00
 *       Cr  Pension payable                                 28,080.00
 *       Cr  NHF payable                                          0.00
 *       Cr  Net salaries payable                           170,992.00
 *                                             -----------  -----------
 *                                              210,600.00   210,600.00
 *
 * Note the accrual: nothing touches the bank here. Payment is a second,
 * separate entry (Dr net salaries payable / Cr bank) raised when the
 * transfers actually clear, and the statutory remittances to the PFA and
 * the tax authority are two more. That separation is what lets you see, at
 * any moment, what you owe but have not yet remitted — which is exactly
 * the number that gets a company into trouble when it is only tracked in
 * a spreadsheet.
 */

export const PAYROLL_ACCOUNTS = {
  SALARIES_EXPENSE: '6100',
  PENSION_EXPENSE_EMPLOYER: '6110',
  NET_SALARIES_PAYABLE: '2200',
  PAYE_PAYABLE: '2210',
  PENSION_PAYABLE: '2220',
  NHF_PAYABLE: '2230',
} as const;

interface Line {
  code: string;
  debit: Decimal;
  credit: Decimal;
  narration: string;
}

@Injectable()
export class PayrollPostingService {
  constructor(private prisma: PrismaService) {}

  async post(runId: string, actorId: string) {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({
      where: { id: runId },
      include: { payslips: true },
    });

    if (run.status !== 'APPROVED') {
      throw new BadRequestException(
        'Only an MD-approved run can be posted to the ledger.',
      );
    }
    if (run.journalEntryId) {
      throw new BadRequestException('This run is already posted.');
    }

    const sum = (pick: (p: (typeof run.payslips)[number]) => Decimal.Value) =>
      run.payslips.reduce((a, p) => a.plus(new Decimal(pick(p))), new Decimal(0));

    const gross = sum((p) => p.monthlyGross);
    const paye = sum((p) => p.paye);
    const pensionEmployee = sum((p) => p.pensionEmployee);
    const pensionEmployer = sum((p) => p.pensionEmployer);
    const nhf = sum((p) => p.nhf);
    const net = sum((p) => p.netPay);

    const period = `${String(run.periodMonth).padStart(2, '0')}/${run.periodYear}`;

    const lines: Line[] = [
      {
        code: PAYROLL_ACCOUNTS.SALARIES_EXPENSE,
        debit: gross,
        credit: new Decimal(0),
        narration: `Gross salaries ${period}`,
      },
      {
        code: PAYROLL_ACCOUNTS.PENSION_EXPENSE_EMPLOYER,
        debit: pensionEmployer,
        credit: new Decimal(0),
        narration: `Employer pension contribution ${period}`,
      },
      {
        code: PAYROLL_ACCOUNTS.PAYE_PAYABLE,
        debit: new Decimal(0),
        credit: paye,
        narration: `PAYE withheld ${period}`,
      },
      {
        code: PAYROLL_ACCOUNTS.PENSION_PAYABLE,
        debit: new Decimal(0),
        credit: pensionEmployee.plus(pensionEmployer),
        narration: `Pension payable to PFA ${period}`,
      },
      {
        code: PAYROLL_ACCOUNTS.NHF_PAYABLE,
        debit: new Decimal(0),
        credit: nhf,
        narration: `NHF withheld ${period}`,
      },
      {
        code: PAYROLL_ACCOUNTS.NET_SALARIES_PAYABLE,
        debit: new Decimal(0),
        credit: net,
        narration: `Net salaries payable ${period}`,
      },
    ].filter((l) => !l.debit.isZero() || !l.credit.isZero());

    const totalDebit = lines.reduce((a, l) => a.plus(l.debit), new Decimal(0));
    const totalCredit = lines.reduce((a, l) => a.plus(l.credit), new Decimal(0));

    // The database trigger catches this too. Failing here gives a far
    // better error message than a Postgres exception surfacing in the UI.
    if (!totalDebit.equals(totalCredit)) {
      throw new BadRequestException(
        `Payroll run ${run.reference} does not balance: ` +
          `debits ${totalDebit}, credits ${totalCredit}. ` +
          `Difference ${totalDebit.minus(totalCredit)}.`,
      );
    }

    const accounts = await this.prisma.account.findMany({
      where: { code: { in: lines.map((l) => l.code) } },
    });
    const byCode = new Map(accounts.map((a) => [a.code, a.id]));
    const missing = lines.filter((l) => !byCode.has(l.code)).map((l) => l.code);
    if (missing.length) {
      throw new BadRequestException(
        `Chart of accounts is missing: ${missing.join(', ')}. Run the account seed.`,
      );
    }

    const period_ = await this.prisma.fiscalPeriod.findUniqueOrThrow({
      where: { year_month: { year: run.periodYear, month: run.periodMonth } },
    });
    if (period_.isClosed) {
      throw new BadRequestException(
        `Fiscal period ${period} is closed. Reopen it before posting payroll.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.create({
        data: {
          reference: `JV/${run.reference}`,
          // Month end in UTC. Using the local-time Date constructor here
          // would place the entry in a different month for anyone west of
          // UTC, so a July run posted from Lagos and the same run posted
          // from a UTC server would land in different fiscal periods.
          date: new Date(Date.UTC(run.periodYear, run.periodMonth, 0)),
          narration: `Payroll ${period}`,
          sourceType: 'payroll_run',
          sourceId: run.id,
          status: 'POSTED',
          periodId: period_.id,
          postedById: actorId,
          postedAt: new Date(),
          lines: {
            create: lines.map((l, i) => ({
              accountId: byCode.get(l.code)!,
              debit: l.debit.toFixed(4),
              credit: l.credit.toFixed(4),
              narration: l.narration,
              sortOrder: i,
            })),
          },
        },
      });

      await tx.payrollRun.update({
        where: { id: run.id },
        data: {
          status: 'POSTED',
          journalEntryId: entry.id,
          postedById: actorId,
          postedAt: new Date(),
        },
      });

      await tx.payrollApproval.create({
        data: {
          runId: run.id,
          action: 'POST',
          fromStatus: 'APPROVED',
          toStatus: 'POSTED',
          actorId,
          actorRole: 'ACCOUNTANT',
          remarks: `Posted as ${entry.reference}`,
        },
      });

      return entry;
    });
  }
}
