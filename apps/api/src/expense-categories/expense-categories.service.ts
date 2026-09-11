import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { z } from 'zod';
import {
  expenseCategorySchema,
  updateExpenseCategorySchema,
} from './expense-categories.controller';

@Injectable()
export class ExpenseCategoriesService {
  constructor(private prisma: PrismaService) {}

  async findAll(includeInactive = false) {
    return this.prisma.expenseCategory.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { code: 'asc' },
      include: {
        account: true,
        _count: {
          select: { vouchers: true, budgetLines: true },
        },
      },
    });
  }

  async getOptions() {
    return this.prisma.expenseCategory.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        accountId: true,
        account: { select: { id: true, code: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    return this.prisma.expenseCategory.findUniqueOrThrow({
      where: { id },
      include: {
        account: true,
        _count: {
          select: { vouchers: true, budgetLines: true },
        },
      },
    });
  }

  async create(data: z.infer<typeof expenseCategorySchema>, actorId: string) {
    const clash = await this.prisma.expenseCategory.findFirst({
      where: {
        OR: [
          { code: data.code },
          { name: { equals: data.name, mode: 'insensitive' } },
        ],
      },
    });
    if (clash) {
      throw new ConflictException(
        `An expense category with code "${data.code}" or name "${data.name}" already exists.`,
      );
    }

    if (data.accountId) {
      await this.prisma.account.findUniqueOrThrow({
        where: { id: data.accountId },
      });
    }

    const created = await this.prisma.expenseCategory.create({
      data: {
        code: data.code,
        name: data.name,
        description: data.description,
        accountId: data.accountId,
        isActive: data.isActive,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'expense_category.created',
        entityType: 'ExpenseCategory',
        entityId: created.id,
        after: { code: created.code, name: created.name } as never,
      },
    });

    return created;
  }

  async update(
    id: string,
    data: z.infer<typeof updateExpenseCategorySchema>,
    actorId: string,
  ) {
    const before = await this.prisma.expenseCategory.findUniqueOrThrow({
      where: { id },
    });

    if (data.code && data.code !== before.code) {
      const clash = await this.prisma.expenseCategory.findFirst({
        where: { code: data.code, id: { not: id } },
      });
      if (clash) {
        throw new ConflictException(`Code "${data.code}" is already in use.`);
      }
    }

    if (data.name && data.name !== before.name) {
      const clash = await this.prisma.expenseCategory.findFirst({
        where: {
          name: { equals: data.name, mode: 'insensitive' },
          id: { not: id },
        },
      });
      if (clash) {
        throw new ConflictException(`Name "${data.name}" is already in use.`);
      }
    }

    if (data.accountId) {
      await this.prisma.account.findUniqueOrThrow({
        where: { id: data.accountId },
      });
    }

    const updated = await this.prisma.expenseCategory.update({
      where: { id },
      data,
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'expense_category.updated',
        entityType: 'ExpenseCategory',
        entityId: id,
        before: { code: before.code, name: before.name } as never,
        after: { code: updated.code, name: updated.name } as never,
      },
    });

    return updated;
  }

  async remove(id: string, actorId: string) {
    const category = await this.prisma.expenseCategory.findUniqueOrThrow({
      where: { id },
      include: {
        _count: { select: { vouchers: true, budgetLines: true } },
      },
    });

    if (category._count.vouchers > 0) {
      throw new BadRequestException(
        `"${category.name}" has ${category._count.vouchers} voucher(s). ` +
        `Deactivate it instead of deleting.`,
      );
    }

    if (category._count.budgetLines > 0) {
      throw new BadRequestException(
        `"${category.name}" is used in ${category._count.budgetLines} budget line(s). ` +
        `Deactivate it instead of deleting.`,
      );
    }

    await this.prisma.expenseCategory.delete({ where: { id } });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'expense_category.deleted',
        entityType: 'ExpenseCategory',
        entityId: id,
        before: { code: category.code, name: category.name } as never,
      },
    });

    return { ok: true };
  }
}