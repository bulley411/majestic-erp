import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { budgetSchema } from './budgets.controller';

@Injectable()
export class BudgetsService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: { year?: number; status?: string }) {
    const where: any = {};
    if (filters.year) where.year = filters.year;
    if (filters.status) where.status = filters.status;

    return this.prisma.budget.findMany({
      where,
      orderBy: [{ year: 'desc' }, { createdAt: 'desc' }],
      include: {
        _count: { select: { lines: true } },
      },
    });
  }

  async getCurrent() {
    const year = new Date().getUTCFullYear();
    const budget = await this.prisma.budget.findFirst({
      where: { year, status: 'ACTIVE' },
      include: { lines: { include: { category: true } } },
    });
    return budget;
  }

  async findOne(id: string) {
    const budget = await this.prisma.budget.findUniqueOrThrow({
      where: { id },
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

    // Compute totals
    let totalBudgeted = new Decimal(0);
    let totalSpent = new Decimal(0);
    let totalCommitted = new Decimal(0);

    for (const line of budget.lines) {
      totalBudgeted = totalBudgeted.plus(line.amountBudgeted.toString());
      totalSpent = totalSpent.plus(line.amountSpent.toString());
      totalCommitted = totalCommitted.plus(line.amountCommitted.toString());
    }

    return {
      ...budget,
      totals: {
        budgeted: totalBudgeted.toFixed(2),
        spent: totalSpent.toFixed(2),
        committed: totalCommitted.toFixed(2),
        remaining: totalBudgeted.minus(totalSpent).minus(totalCommitted).toFixed(2),
      },
    };
  }

  async create(data: z.infer<typeof budgetSchema>, actorId: string) {
    // Check if a budget for this year already exists
    const existing = await this.prisma.budget.findFirst({
      where: { year: data.year },
    });
    if (existing) {
      throw new ConflictException(
        `A budget for ${data.year} already exists: "${existing.name}". ` +
        `You can only have one comprehensive budget per year.`,
      );
    }

    // Validate all categories exist
    const categoryIds = data.lines.map((l) => l.categoryId);
    const categories = await this.prisma.expenseCategory.findMany({
      where: { id: { in: categoryIds } },
    });
    if (categories.length !== categoryIds.length) {
      throw new BadRequestException('One or more categories not found.');
    }

    // Calculate total
    const total = data.lines.reduce(
      (sum, l) => sum.plus(l.amountBudgeted),
      new Decimal(0),
    );

    return this.prisma.$transaction(async (tx) => {
      const budget = await tx.budget.create({
        data: {
          name: data.name,
          year: data.year,
          notes: data.notes,
          status: 'DRAFT',
          totalBudget: total.toFixed(4),
          createdById: actorId,
          lines: {
            create: data.lines.map((l, i) => ({
              categoryId: l.categoryId,
              itemName: l.itemName,
              amountBudgeted: new Decimal(l.amountBudgeted).toFixed(4),
              notes: l.notes,
              sortOrder: i,
            })),
          },
        },
        include: { lines: true },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: 'budget.created',
          entityType: 'Budget',
          entityId: budget.id,
          after: {
            name: budget.name,
            year: budget.year,
            totalBudget: total.toFixed(2),
            lines: data.lines.length,
          } as never,
        },
      });

      return budget;
    });
  }

  async update(id: string, data: any, actorId: string) {
    const before = await this.prisma.budget.findUniqueOrThrow({
      where: { id },
      include: { lines: true },
    });

    if (before.status === 'CLOSED') {
      throw new BadRequestException('Closed budgets cannot be edited.');
    }

    return this.prisma.$transaction(async (tx) => {
      // If lines are being updated, delete old ones and recreate
      if (data.lines) {
        // Validate categories
        const categoryIds = data.lines.map((l: any) => l.categoryId);
        const categories = await tx.expenseCategory.findMany({
          where: { id: { in: categoryIds } },
        });
        if (categories.length !== categoryIds.length) {
          throw new BadRequestException('One or more categories not found.');
        }

        // Delete old lines
        await tx.budgetLine.deleteMany({ where: { budgetId: id } });

        // Calculate new total
        const total = data.lines.reduce(
          (sum: Decimal, l: any) => sum.plus(l.amountBudgeted),
          new Decimal(0),
        );

        // Create new lines
        await tx.budgetLine.createMany({
          data: data.lines.map((l: any, i: number) => ({
            budgetId: id,
            categoryId: l.categoryId,
            itemName: l.itemName,
            amountBudgeted: new Decimal(l.amountBudgeted).toFixed(4),
            notes: l.notes,
            sortOrder: i,
          })),
        });

        // Update budget total
        data.totalBudget = total.toFixed(4);
      }

      const updated = await tx.budget.update({
        where: { id },
        data: {
          name: data.name,
          year: data.year,
          notes: data.notes,
          totalBudget: data.totalBudget,
        },
        include: { lines: true },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: 'budget.updated',
          entityType: 'Budget',
          entityId: id,
          before: { name: before.name, totalBudget: before.totalBudget.toString() } as never,
          after: { name: updated.name, totalBudget: updated.totalBudget.toString() } as never,
        },
      });

      return updated;
    });
  }

  async setStatus(id: string, status: string, actorId: string) {
    const budget = await this.prisma.budget.findUniqueOrThrow({ where: { id } });

    // Validate status transitions
    if (budget.status === 'CLOSED') {
      throw new BadRequestException('Closed budgets cannot be reopened.');
    }

    if (status === 'ACTIVE') {
      // Deactivate any other active budgets for this year
      await this.prisma.budget.updateMany({
        where: { year: budget.year, status: 'ACTIVE', id: { not: id } },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    }

    const updated = await this.prisma.budget.update({
      where: { id },
      data: {
        status: status as any,
        activatedAt: status === 'ACTIVE' ? new Date() : budget.activatedAt,
        closedAt: status === 'CLOSED' ? new Date() : budget.closedAt,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: `budget.${status.toLowerCase()}`,
        entityType: 'Budget',
        entityId: id,
        before: { status: budget.status } as never,
        after: { status: updated.status } as never,
      },
    });

    return updated;
  }

  async remove(id: string, actorId: string) {
    const budget = await this.prisma.budget.findUniqueOrThrow({ where: { id } });

    if (budget.status !== 'DRAFT') {
      throw new BadRequestException('Only draft budgets can be deleted.');
    }

    await this.prisma.budget.delete({ where: { id } });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'budget.deleted',
        entityType: 'Budget',
        entityId: id,
        before: { name: budget.name, year: budget.year } as never,
      },
    });

    return { ok: true };
  }

  /**
   * Recalculate spent/committed amounts for a budget from actual vouchers.
   * Called when vouchers are posted or updated.
   */
  async recalculateSpent(budgetId: string) {
    const budget = await this.prisma.budget.findUnique({
      where: { id: budgetId },
      include: { lines: true },
    });
    if (!budget) return;

    for (const line of budget.lines) {
      // Get vouchers for this category in this year
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

      await this.prisma.budgetLine.update({
        where: { id: line.id },
        data: {
          amountSpent: spent.toFixed(4),
          amountCommitted: committed.toFixed(4),
        },
      });
    }
  }

  /**
   * Check if a voucher would exceed the budget for its category.
   * Returns the check result, doesn't throw.
   */
  async checkVoucherAgainstBudget(
    categoryId: string,
    amount: number,
    date: Date,
  ): Promise<{
    hasBudget: boolean;
    exceeded: boolean;
    remaining: string;
    budgeted: string;
    spent: string;
    committed: string;
  }> {
    const year = date.getUTCFullYear();

    const budget = await this.prisma.budget.findFirst({
      where: { year, status: 'ACTIVE' },
      include: {
        lines: {
          where: { categoryId },
        },
      },
    });

    if (!budget || !budget.lines.length) {
      return {
        hasBudget: false,
        exceeded: false,
        remaining: '0.00',
        budgeted: '0.00',
        spent: '0.00',
        committed: '0.00',
      };
    }

    const line = budget.lines[0];
    const budgeted = new Decimal(line.amountBudgeted.toString());
    const spent = new Decimal(line.amountSpent.toString());
    const committed = new Decimal(line.amountCommitted.toString());
    const voucherAmount = new Decimal(amount);

    const remaining = budgeted.minus(spent).minus(committed);
    const exceeded = voucherAmount.gt(remaining);

    return {
      hasBudget: true,
      exceeded,
      remaining: remaining.toFixed(2),
      budgeted: budgeted.toFixed(2),
      spent: spent.toFixed(2),
      committed: committed.toFixed(2),
    };
  }
}