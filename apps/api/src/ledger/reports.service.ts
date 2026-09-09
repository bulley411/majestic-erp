import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import Decimal from 'decimal.js';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /* -------------------- Trial Balance -------------------- */

  async trialBalance(asAt?: string, periodId?: string) {
    const where: any = {};
    if (periodId) {
      where.entry = { periodId };
    } else if (asAt) {
      where.entry = { date: { lte: new Date(asAt) } };
    }

    const lines = await this.prisma.journalLine.findMany({
      where,
      include: {
        account: true,
        entry: true,
      },
    });

    const balances = new Map();

    for (const line of lines) {
      const key = line.accountId;
      if (!balances.has(key)) {
        balances.set(key, {
          accountId: line.accountId,
          code: line.account.code,
          name: line.account.name,
          type: line.account.type,
          debit: new Decimal(0),
          credit: new Decimal(0),
        });
      }
      const b = balances.get(key);
      b.debit = b.debit.plus(line.debit.toString());
      b.credit = b.credit.plus(line.credit.toString());
    }

    const result = Array.from(balances.values()).map((b) => ({
      ...b,
      debit: b.debit.toFixed(2),
      credit: b.credit.toFixed(2),
      balance: b.debit.minus(b.credit).toFixed(2),
    }));

    const totalDebit = result.reduce((sum, b) => sum.plus(b.debit), new Decimal(0));
    const totalCredit = result.reduce((sum, b) => sum.plus(b.credit), new Decimal(0));

    return {
      accounts: result,
      summary: {
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
        isBalanced: totalDebit.equals(totalCredit),
      },
    };
  }

  /* -------------------- Income Statement -------------------- */

  async incomeStatement(fromDate?: string, toDate?: string, periodId?: string) {
    const where: any = {};
    if (periodId) {
      where.entry = { periodId };
    } else {
      if (fromDate) where.entry = { date: { gte: new Date(fromDate) } };
      if (toDate) where.entry = { ...where.entry, date: { lte: new Date(toDate) } };
    }

    const lines = await this.prisma.journalLine.findMany({
      where,
      include: {
        account: true,
        entry: true,
      },
    });

    const incomeAccounts: any[] = [];
    const expenseAccounts: any[] = [];

    for (const line of lines) {
      const account = line.account;
      if (account.type === 'INCOME' || account.type === 'EXPENSE') {
        const amount = new Decimal(line.debit.toString()).minus(line.credit.toString());
        const entry = {
          accountId: account.id,
          code: account.code,
          name: account.name,
          amount: amount.toFixed(2),
        };
        if (account.type === 'INCOME') {
          incomeAccounts.push(entry);
        } else {
          expenseAccounts.push(entry);
        }
      }
    }

    const totalIncome = incomeAccounts.reduce((sum, a) => sum.plus(a.amount), new Decimal(0));
    const totalExpenses = expenseAccounts.reduce((sum, a) => sum.plus(a.amount), new Decimal(0));
    const netIncome = totalIncome.minus(totalExpenses);

    return {
      period: periodId ? 'Fixed period' : `${fromDate || 'start'} to ${toDate || 'now'}`,
      income: incomeAccounts,
      expenses: expenseAccounts,
      summary: {
        totalIncome: totalIncome.toFixed(2),
        totalExpenses: totalExpenses.toFixed(2),
        netIncome: netIncome.toFixed(2),
      },
    };
  }

  /* -------------------- Balance Sheet -------------------- */

  async balanceSheet(asAt?: string, periodId?: string) {
    const where: any = {};
    if (periodId) {
      where.entry = { periodId };
    } else if (asAt) {
      where.entry = { date: { lte: new Date(asAt) } };
    }

    const lines = await this.prisma.journalLine.findMany({
      where,
      include: {
        account: true,
        entry: true,
      },
    });

    const balances = new Map();

    for (const line of lines) {
      const key = line.accountId;
      if (!balances.has(key)) {
        balances.set(key, {
          accountId: line.accountId,
          code: line.account.code,
          name: line.account.name,
          type: line.account.type,
          balance: new Decimal(0),
        });
      }
      const b = balances.get(key);
      // For asset/expense accounts: debit - credit
      // For liability/equity/income: credit - debit
      const amount = new Decimal(line.debit.toString()).minus(line.credit.toString());
      if (['ASSET', 'EXPENSE'].includes(line.account.type)) {
        b.balance = b.balance.plus(amount);
      } else {
        b.balance = b.balance.minus(amount);
      }
    }

    const assets: any[] = [];
    const liabilities: any[] = [];
    const equity: any[] = [];

    for (const b of balances.values()) {
      const entry = {
        code: b.code,
        name: b.name,
        balance: b.balance.toFixed(2),
      };
      if (b.type === 'ASSET') assets.push(entry);
      else if (b.type === 'LIABILITY') liabilities.push(entry);
      else if (b.type === 'EQUITY') equity.push(entry);
    }

    const totalAssets = assets.reduce((sum, a) => sum.plus(a.balance), new Decimal(0));
    const totalLiabilities = liabilities.reduce((sum, a) => sum.plus(a.balance), new Decimal(0));
    const totalEquity = equity.reduce((sum, a) => sum.plus(a.balance), new Decimal(0));

    return {
      asAt: asAt || 'current',
      assets,
      liabilities,
      equity,
      summary: {
        totalAssets: totalAssets.toFixed(2),
        totalLiabilities: totalLiabilities.toFixed(2),
        totalEquity: totalEquity.toFixed(2),
        totalLiabilitiesAndEquity: totalLiabilities.plus(totalEquity).toFixed(2),
      },
    };
  }

  /* -------------------- General Ledger -------------------- */

  async generalLedger(accountId?: string, fromDate?: string, toDate?: string) {
    const where: any = {};
    if (accountId) where.accountId = accountId;
    if (fromDate) where.entry = { date: { gte: new Date(fromDate) } };
    if (toDate) where.entry = { ...where.entry, date: { lte: new Date(toDate) } };

    const lines = await this.prisma.journalLine.findMany({
      where,
      include: {
        account: true,
        entry: true,
      },
      orderBy: [{ entry: { date: 'asc' } }, { entry: { reference: 'asc' } }],
    });

    const entries = lines.map((line) => ({
      date: line.entry.date,
      reference: line.entry.reference,
      narration: line.entry.narration,
      accountCode: line.account.code,
      accountName: line.account.name,
      debit: line.debit.toString(),
      credit: line.credit.toString(),
      balance: new Decimal(line.debit.toString()).minus(line.credit.toString()).toFixed(2),
    }));

    return {
      accountId: accountId || 'all',
      fromDate: fromDate || 'start',
      toDate: toDate || 'now',
      entries,
      count: entries.length,
    };
  }
}