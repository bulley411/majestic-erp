import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PayrollSettingsService } from './payroll-settings.service';
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
 * The accounts used are configurable via PayrollSettingsService. If no
 * mapping has been set, it falls back to the seeded chart of accounts.
 *
 * Note the accrual: nothing touches the bank here. Payment is a second,
 * separate entry (Dr net salaries payable / Cr bank) raised when the
 * transfers actually clear, and the statutory remittances to the PFA and
 * the tax authority are two more.
 */

@Injectable()
export class PayrollPostingService {
  constructor(
    private prisma: PrismaService,
    private settings: PayrollSettingsService,
  ) {}

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

    // Resolve the account IDs to use — configured mappings or seeded defaults
    const accounts = await this.settings.getResolvedAccounts();

    interface Line {
      accountId: string;
      debit: Decimal;
      credit: Decimal;
      narration: string;
    }

    const lines: Line[] = [
      {
        accountId: accounts.SALARIES_EXPENSE,
        debit: gross,
        credit: new Decimal(0),
        narration: `Gross salaries ${period}`,
      },
      {
        accountId: accounts.PENSION_EXPENSE_EMPLOYER,
        debit: pensionEmployer,
        credit: new Decimal(0),
        narration: `Employer pension contribution ${period}`,
      },
      {
        accountId: accounts.PAYE_PAYABLE,
        debit: new Decimal(0),
        credit: paye,
        narration: `PAYE withheld ${period}`,
      },
      {
        accountId: accounts.PENSION_PAYABLE,
        debit: new Decimal(0),
        credit: pensionEmployee.plus(pensionEmployer),
        narration: `Pension payable to PFA ${period}`,
      },
      {
        accountId: accounts.NHF_PAYABLE,
        debit: new Decimal(0),
        credit: nhf,
        narration: `NHF withheld ${period}`,
      },
      {
        accountId: accounts.NET_SALARIES_PAYABLE,
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

    // Verify all accounts still exist and are active
    const accountIds = lines.map((l) => l.accountId);
    const foundAccounts = await this.prisma.account.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, code: true, name: true, isActive: true },
    });

    const foundIds = new Set(foundAccounts.map((a) => a.id));
    const missing = accountIds.filter((id) => !foundIds.has(id));
    if (missing.length) {
      throw new BadRequestException(
        `Some payroll accounts no longer exist: ${missing.join(', ')}. ` +
        `Please reconfigure the payroll account mappings in Finance settings.`,
      );
    }

    const inactive = foundAccounts.filter((a) => !a.isActive);
    if (inactive.length) {
      const names = inactive.map((a) => `${a.code} - ${a.name}`).join(', ');
      throw new BadRequestException(
        `These payroll accounts are inactive: ${names}. ` +
        `Activate them or remap payroll to active accounts.`,
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
              accountId: l.accountId,
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