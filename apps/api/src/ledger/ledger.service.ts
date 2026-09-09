import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import Decimal from 'decimal.js';

@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  /* -------------------- Chart of Accounts -------------------- */

  async getAccounts(includeInactive = false) {
    return this.prisma.account.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { code: 'asc' },
      include: {
        _count: { select: { lines: true } },
        children: {
          where: includeInactive ? {} : { isActive: true },
          orderBy: { code: 'asc' },
        },
      },
    });
  }

  async getAccountTree(includeInactive = false) {
    const accounts = await this.getAccounts(includeInactive);
    // Build tree structure
    const map = new Map();
    const roots: any[] = [];

    for (const acc of accounts) {
      map.set(acc.id, { ...acc, children: [] });
    }

    for (const acc of accounts) {
      const node = map.get(acc.id);
      if (acc.parentId) {
        const parent = map.get(acc.parentId);
        if (parent) parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async getAccount(id: string) {
    return this.prisma.account.findUniqueOrThrow({
      where: { id },
      include: {
        children: { where: { isActive: true }, orderBy: { code: 'asc' } },
        parent: true,
      },
    });
  }

  async getAccountBalance(accountId: string, fromDate?: string, toDate?: string) {
    const where: any = { accountId };
    if (fromDate) where.entry = { date: { gte: new Date(fromDate) } };
    if (toDate) where.entry = { ...where.entry, date: { lte: new Date(toDate) } };

    const lines = await this.prisma.journalLine.findMany({
      where,
      include: { entry: true },
    });

    let debit = new Decimal(0);
    let credit = new Decimal(0);

    for (const line of lines) {
      debit = debit.plus(line.debit.toString());
      credit = credit.plus(line.credit.toString());
    }

    return {
      accountId,
      debit: debit.toFixed(2),
      credit: credit.toFixed(2),
      balance: debit.minus(credit).toFixed(2),
    };
  }

  /* -------------------- Chart of Accounts CRUD -------------------- */

async createAccount(data: any, actorId: string) {
  // Check if code already exists
  const existing = await this.prisma.account.findUnique({
    where: { code: data.code },
  });
  if (existing) {
    throw new ConflictException(`Account code "${data.code}" already exists.`);
  }

  // Validate parent exists if provided
  if (data.parentId) {
    await this.prisma.account.findUniqueOrThrow({
      where: { id: data.parentId },
    });
  }

  const account = await this.prisma.account.create({
    data: {
      code: data.code,
      name: data.name,
      type: data.type,
      parentId: data.parentId || null,
      isActive: data.isActive !== undefined ? data.isActive : true,
    },
  });

  await this.prisma.auditLog.create({
    data: {
      actorId,
      action: 'account.created',
      entityType: 'Account',
      entityId: account.id,
      after: { code: account.code, name: account.name, type: account.type } as never,
    },
  });

  return account;
}

async updateAccount(id: string, data: any, actorId: string) {
  const before = await this.prisma.account.findUniqueOrThrow({ where: { id } });

  // Check if code is being changed and is unique
  if (data.code && data.code !== before.code) {
    const existing = await this.prisma.account.findUnique({
      where: { code: data.code },
    });
    if (existing) {
      throw new ConflictException(`Account code "${data.code}" already exists.`);
    }
  }

  // Validate parent exists if provided
  if (data.parentId) {
    await this.prisma.account.findUniqueOrThrow({
      where: { id: data.parentId },
    });
  }

  const account = await this.prisma.account.update({
    where: { id },
    data: {
      code: data.code,
      name: data.name,
      type: data.type,
      parentId: data.parentId !== undefined ? data.parentId : undefined,
      isActive: data.isActive !== undefined ? data.isActive : undefined,
    },
  });

  await this.prisma.auditLog.create({
    data: {
      actorId,
      action: 'account.updated',
      entityType: 'Account',
      entityId: id,
      before: { code: before.code, name: before.name } as never,
      after: { code: account.code, name: account.name } as never,
    },
  });

  return account;
}

async deleteAccount(id: string, actorId: string) {
  const account = await this.prisma.account.findUniqueOrThrow({
    where: { id },
    include: { _count: { select: { lines: true } } },
  });

  // Prevent deletion if account has journal entries
  if (account._count.lines > 0) {
    throw new BadRequestException(
      `Account "${account.code} - ${account.name}" has ${account._count.lines} journal entries. ` +
      'Deactivate instead of deleting.'
    );
  }

  // Check if account has children
  const children = await this.prisma.account.findMany({
    where: { parentId: id },
  });
  if (children.length > 0) {
    throw new BadRequestException(
      `Account "${account.code} - ${account.name}" has ${children.length} child account(s). ` +
      'Delete or reassign children first.'
    );
  }

  await this.prisma.account.delete({ where: { id } });

  await this.prisma.auditLog.create({
    data: {
      actorId,
      action: 'account.deleted',
      entityType: 'Account',
      entityId: id,
      before: { code: account.code, name: account.name } as never,
    },
  });

  return { ok: true };
}

async toggleAccount(id: string, actorId: string) {
  const account = await this.prisma.account.findUniqueOrThrow({ where: { id } });
  const updated = await this.prisma.account.update({
    where: { id },
    data: { isActive: !account.isActive },
  });

  await this.prisma.auditLog.create({
    data: {
      actorId,
      action: account.isActive ? 'account.deactivated' : 'account.activated',
      entityType: 'Account',
      entityId: id,
      after: { isActive: updated.isActive } as never,
    },
  });

  return updated;
}
  /* -------------------- Journal Entries -------------------- */

  async getJournalEntries(filters: {
    fromDate?: string;
    toDate?: string;
    status?: string;
    sourceType?: string;
  }) {
    const where: any = {};
    if (filters.fromDate) where.date = { gte: new Date(filters.fromDate) };
    if (filters.toDate) where.date = { ...where.date, lte: new Date(filters.toDate) };
    if (filters.status) where.status = filters.status;
    if (filters.sourceType) where.sourceType = filters.sourceType;

    return this.prisma.journalEntry.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        period: true,
        lines: {
          include: { account: true },
          orderBy: { sortOrder: 'asc' },
        },
        _count: { select: { lines: true } },
      },
    });
  }

  async getJournalEntry(id: string) {
    return this.prisma.journalEntry.findUniqueOrThrow({
      where: { id },
      include: {
        period: true,
        lines: {
          include: { account: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  async reverseJournalEntry(id: string, actorId: string) {
    const original = await this.getJournalEntry(id);
    if (original.status !== 'POSTED') {
      throw new BadRequestException('Only posted entries can be reversed.');
    }

    // Check if already reversed
    const existingReverse = await this.prisma.journalEntry.findFirst({
      where: { reversesId: id },
    });
    if (existingReverse) {
      throw new ConflictException('This entry has already been reversed.');
    }

    const period = await this.prisma.fiscalPeriod.findUniqueOrThrow({
      where: { id: original.periodId },
    });

    if (period.isClosed) {
      throw new BadRequestException('Cannot reverse in a closed period.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Create reversing entry
      const reversed = await tx.journalEntry.create({
        data: {
          reference: `REV/${original.reference}`,
          date: new Date(),
          narration: `Reversal of ${original.reference}: ${original.narration}`,
          sourceType: 'reversal',
          sourceId: original.id,
          status: 'POSTED',
          periodId: original.periodId,
          postedById: actorId,
          postedAt: new Date(),
          reversesId: original.id,
          lines: {
            create: original.lines.map((line, i) => ({
              accountId: line.accountId,
              // Swap debit and credit
              debit: line.credit.toString(),
              credit: line.debit.toString(),
              narration: `Reversal: ${line.narration || ''}`,
              sortOrder: i,
            })),
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: 'journal_entry.reversed',
          entityType: 'JournalEntry',
          entityId: original.id,
          after: { reversedId: reversed.id } as never,
        },
      });

      return reversed;
    });
  }

  /* -------------------- Fiscal Periods -------------------- */

  async getPeriods(year?: number) {
    const where: any = {};
    if (year) where.year = year;
    return this.prisma.fiscalPeriod.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async getCurrentPeriod() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    return this.prisma.fiscalPeriod.findUnique({
      where: { year_month: { year, month } },
    });
  }

  async closePeriod(id: string, actorId: string) {
    const period = await this.prisma.fiscalPeriod.findUniqueOrThrow({ where: { id } });
    if (period.isClosed) {
      throw new ConflictException('This period is already closed.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.fiscalPeriod.update({
        where: { id },
        data: { isClosed: true, closedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: 'period.closed',
          entityType: 'FiscalPeriod',
          entityId: id,
          after: { year: period.year, month: period.month } as never,
        },
      });

      return updated;
    });
  }

  async reopenPeriod(id: string, actorId: string) {
    const period = await this.prisma.fiscalPeriod.findUniqueOrThrow({ where: { id } });
    if (!period.isClosed) {
      throw new ConflictException('This period is already open.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.fiscalPeriod.update({
        where: { id },
        data: { isClosed: false, closedAt: null },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: 'period.reopened',
          entityType: 'FiscalPeriod',
          entityId: id,
          after: { year: period.year, month: period.month } as never,
        },
      });

      return updated;
    });
  }
}