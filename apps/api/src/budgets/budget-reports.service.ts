import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import Decimal from 'decimal.js';

@Injectable()
export class BudgetReportsService {
  constructor(private prisma: PrismaService) {}

  /**
   * High-level summary of the budget for a year.
   */
  async budgetSummary(year?: number) {
    const y = year || new Date().getUTCFullYear();
    const budget = await this.prisma.budget.findFirst({
      where: { year: y, status: { in: ['ACTIVE', 'CLOSED'] } },
      include: {
        lines: {
          include: {
            category: {
              include: { account: true },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!budget) {
      return { year: y, budget: null, message: 'No budget for this year' };
    }

    let totalBudgeted = new Decimal(0);
    let totalSpent = new Decimal(0);
    let totalCommitted = new Decimal(0);

    const lines = budget.lines.map((line) => {
      const budgeted = new Decimal(line.amountBudgeted.toString());
      const spent = new Decimal(line.amountSpent.toString());
      const committed = new Decimal(line.amountCommitted.toString());
      const remaining = budgeted.minus(spent).minus(committed);
      const variance = budgeted.minus(spent);
      const percentUsed = budgeted.isZero()
        ? new Decimal(0)
        : spent.dividedBy(budgeted).times(100);

      totalBudgeted = totalBudgeted.plus(budgeted);
      totalSpent = totalSpent.plus(spent);
      totalCommitted = totalCommitted.plus(committed);

      return {
        id: line.id,
        itemName: line.itemName,
        categoryName: line.category.name,
        categoryCode: line.category.code,
        accountCode: line.category.account?.code || null,
        accountName: line.category.account?.name || null,
        budgeted: budgeted.toFixed(2),
        spent: spent.toFixed(2),
        committed: committed.toFixed(2),
        remaining: remaining.toFixed(2),
        variance: variance.toFixed(2),
        percentUsed: percentUsed.toFixed(2),
        isOverBudget: spent.gt(budgeted),
      };
    });

    const totalRemaining = totalBudgeted.minus(totalSpent).minus(totalCommitted);
    const totalPercent = totalBudgeted.isZero()
      ? new Decimal(0)
      : totalSpent.dividedBy(totalBudgeted).times(100);

    return {
      year: y,
      budget: {
        id: budget.id,
        name: budget.name,
        status: budget.status,
        totalBudget: totalBudgeted.toFixed(2),
        totalSpent: totalSpent.toFixed(2),
        totalCommitted: totalCommitted.toFixed(2),
        totalRemaining: totalRemaining.toFixed(2),
        percentUsed: totalPercent.toFixed(2),
      },
      lines,
    };
  }

  /**
   * Variance report — Budgeted vs Actual with variance amounts and percentages.
   */
  async varianceReport(year?: number) {
    const summary = await this.budgetSummary(year);
    if (!summary.budget) return summary;

    return {
      year: summary.year,
      generated: new Date().toISOString(),
      budget: summary.budget,
      lines: summary.lines.map((l) => ({
        ...l,
        variancePercent: Number(l.budgeted) === 0
          ? '0.00'
          : ((Number(l.budgeted) - Number(l.spent)) / Number(l.budgeted) * 100).toFixed(2),
      })),
    };
  }

  /**
   * Monthly analysis — Show spending per month for the year.
   */
  async monthlyAnalysis(year?: number) {
    const y = year || new Date().getUTCFullYear();

    // Get all posted vouchers for this year
    const vouchers = await this.prisma.voucher.findMany({
      where: {
        date: {
          gte: new Date(Date.UTC(y, 0, 1)),
          lt: new Date(Date.UTC(y + 1, 0, 1)),
        },
        status: { in: ['POSTED', 'PAID'] },
      },
      select: {
        date: true,
        amount: true,
      },
    });

    // Group by month
    const monthly = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      spent: new Decimal(0),
      count: 0,
    }));

    for (const v of vouchers) {
      const month = v.date.getUTCMonth();
      monthly[month].spent = monthly[month].spent.plus(v.amount.toString());
      monthly[month].count++;
    }

    return {
      year: y,
      months: monthly.map((m) => ({
        month: m.month,
        monthName: new Date(Date.UTC(2000, m.month - 1, 1)).toLocaleString('en-NG', { month: 'long' }),
        spent: m.spent.toFixed(2),
        count: m.count,
      })),
    };
  }

  /**
   * Budget vs Actual for a specific budget.
   */
  async budgetVsActual(budgetId: string) {
    const budget = await this.prisma.budget.findUniqueOrThrow({
      where: { id: budgetId },
      include: {
        lines: {
          include: {
            category: {
              include: { account: true },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    // Recalculate from vouchers (live data)
    let totalBudgeted = new Decimal(0);
    let totalSpent = new Decimal(0);
    let totalCommitted = new Decimal(0);

    const lines = await Promise.all(
      budget.lines.map(async (line) => {
        const vouchers = await this.prisma.voucher.findMany({
          where: {
            categoryId: line.categoryId,
            date: {
              gte: new Date(Date.UTC(budget.year, 0, 1)),
              lt: new Date(Date.UTC(budget.year + 1, 0, 1)),
            },
          },
        });

        let spent = new Decimal(0);
        let committed = new Decimal(0);

        for (const v of vouchers) {
          if (v.status === 'POSTED' || v.status === 'PAID') {
            spent = spent.plus(v.amount.toString());
          } else if (v.status === 'PENDING_APPROVAL' || v.status === 'APPROVED') {
            committed = committed.plus(v.amount.toString());
          }
        }

        const budgeted = new Decimal(line.amountBudgeted.toString());
        const remaining = budgeted.minus(spent).minus(committed);

        totalBudgeted = totalBudgeted.plus(budgeted);
        totalSpent = totalSpent.plus(spent);
        totalCommitted = totalCommitted.plus(committed);

        return {
          id: line.id,
          itemName: line.itemName,
          categoryName: line.category.name,
          accountCode: line.category.account?.code || null,
          accountName: line.category.account?.name || null,
          budgeted: budgeted.toFixed(2),
          spent: spent.toFixed(2),
          committed: committed.toFixed(2),
          remaining: remaining.toFixed(2),
          variance: budgeted.minus(spent).toFixed(2),
          percentUsed: budgeted.isZero()
            ? '0.00'
            : spent.dividedBy(budgeted).times(100).toFixed(2),
          isOverBudget: spent.gt(budgeted),
          voucherCount: vouchers.length,
        };
      }),
    );

    return {
      budget: {
        id: budget.id,
        name: budget.name,
        year: budget.year,
        status: budget.status,
      },
      totals: {
        budgeted: totalBudgeted.toFixed(2),
        spent: totalSpent.toFixed(2),
        committed: totalCommitted.toFixed(2),
        remaining: totalBudgeted.minus(totalSpent).minus(totalCommitted).toFixed(2),
        percentUsed: totalBudgeted.isZero()
          ? '0.00'
          : totalSpent.dividedBy(totalBudgeted).times(100).toFixed(2),
      },
      lines,
    };
  }
}