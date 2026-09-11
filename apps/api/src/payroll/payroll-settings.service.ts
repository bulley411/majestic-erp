import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

const DEFAULT_MAPPINGS = {
  SALARIES_EXPENSE: { code: '6100', type: 'EXPENSE' },
  PENSION_EXPENSE_EMPLOYER: { code: '6110', type: 'EXPENSE' },
  NET_SALARIES_PAYABLE: { code: '2200', type: 'LIABILITY' },
  PAYE_PAYABLE: { code: '2210', type: 'LIABILITY' },
  PENSION_PAYABLE: { code: '2220', type: 'LIABILITY' },
  NHF_PAYABLE: { code: '2230', type: 'LIABILITY' },
};

const REQUIRED_KEYS = Object.keys(DEFAULT_MAPPINGS) as (keyof typeof DEFAULT_MAPPINGS)[];

const KEY_META: Record<string, { label: string; description: string; expectedType: string }> = {
  SALARIES_EXPENSE: {
    label: 'Salaries and wages expense',
    description: 'Where gross salaries are debited when payroll is posted',
    expectedType: 'EXPENSE',
  },
  PENSION_EXPENSE_EMPLOYER: {
    label: 'Employer pension expense',
    description: 'Where the employer 10% pension contribution is debited',
    expectedType: 'EXPENSE',
  },
  NET_SALARIES_PAYABLE: {
    label: 'Net salaries payable',
    description: 'Where net pay owing to employees is credited',
    expectedType: 'LIABILITY',
  },
  PAYE_PAYABLE: {
    label: 'PAYE payable',
    description: 'Where PAYE withheld is credited (owed to FIRS)',
    expectedType: 'LIABILITY',
  },
  PENSION_PAYABLE: {
    label: 'Pension payable',
    description: 'Where employee + employer pension is credited (owed to PFA)',
    expectedType: 'LIABILITY',
  },
  NHF_PAYABLE: {
    label: 'NHF payable',
    description: 'Where NHF withheld is credited (owed to Federal Mortgage Bank)',
    expectedType: 'LIABILITY',
  },
};

@Injectable()
export class PayrollSettingsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get the current mappings. Falls back to defaults if not configured.
   */
  async getMappings() {
    const rows = await this.prisma.payrollAccountMapping.findMany({
      include: { account: true },
    });

    const byKey = new Map(rows.map((r) => [r.key, r]));

    const result: Record<string, any> = {};

    for (const key of REQUIRED_KEYS) {
      const row = byKey.get(key as any);

      if (row) {
        result[key] = {
          key,
          accountId: row.accountId,
          accountCode: row.account.code,
          accountName: row.account.name,
          accountType: row.account.type,
          isDefault: false,
          meta: KEY_META[key],
        };
      } else {
        // Fall back to default
        const fallback = DEFAULT_MAPPINGS[key];
        const account = await this.prisma.account.findUnique({
          where: { code: fallback.code },
        });
        result[key] = {
          key,
          accountId: account?.id || null,
          accountCode: account?.code || fallback.code,
          accountName: account?.name || '(not found)',
          accountType: account?.type || fallback.type,
          isDefault: true,
          meta: KEY_META[key],
        };
      }
    }

    return result;
  }

  /**
   * Update a single mapping.
   */
  async setMapping(key: string, accountId: string, actorId: string) {
    if (!REQUIRED_KEYS.includes(key as any)) {
      throw new BadRequestException(`Unknown payroll account key: ${key}`);
    }

    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });

    // Validate account type matches expected
    const expected = KEY_META[key].expectedType;
    if (account.type !== expected) {
      throw new BadRequestException(
        `"${KEY_META[key].label}" expects an account of type ${expected}, ` +
        `but ${account.code} - ${account.name} is ${account.type}.`
      );
    }

    const mapping = await this.prisma.payrollAccountMapping.upsert({
      where: { key: key as any },
      update: { accountId, updatedById: actorId },
      create: { key: key as any, accountId, updatedById: actorId },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'payroll.mapping_changed',
        entityType: 'PayrollAccountMapping',
        entityId: mapping.id,
        after: { key, accountCode: account.code } as never,
      },
    });

    return mapping;
  }

  /**
   * Get the account IDs for a payroll posting, using configured values or defaults.
   */
  async getResolvedAccounts(): Promise<Record<string, string>> {
    const mappings = await this.getMappings();
    const result: Record<string, string> = {};

    for (const key of REQUIRED_KEYS) {
      const m = mappings[key];
      if (!m.accountId) {
        throw new BadRequestException(
          `Payroll account "${key}" is not configured and default ` +
          `"${DEFAULT_MAPPINGS[key].code}" was not found in the chart of accounts.`
        );
      }
      result[key] = m.accountId;
    }

    return result;
  }
}