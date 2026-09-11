import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Decimal } from 'decimal.js';
import { authorizeVoucherApproval, requiredApprover } from './voucher-approval';
import { voucherSchema } from './vouchers.controller';
import { BudgetsService } from '../budgets/budgets.service';
import { z } from 'zod';

@Injectable()
export class VouchersService {
  constructor(
    private prisma: PrismaService,
    private budgets: BudgetsService,
  ) {}

  async findAll(filters: {
    status?: string;
    vendorId?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.vendorId) where.vendorId = filters.vendorId;
    if (filters.fromDate) where.date = { gte: new Date(filters.fromDate) };
    if (filters.toDate) where.date = { ...where.date, lte: new Date(filters.toDate) };

    return this.prisma.voucher.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        vendor: true,
        category: true,
        bank: true,
        approvals: {
          orderBy: { createdAt: 'asc' },
        },
        _count: {
          select: { approvals: true },
        },
      },
    });
  }

  async getApprovalLimits() {
    const limits = await this.prisma.approvalLimit.findMany({
      where: { documentType: 'VOUCHER' },
      orderBy: { rank: 'asc' },
    });

    return limits.map((l) => ({
      roleCode: l.roleCode,
      rank: l.rank,
      maxAmount: l.maxAmount?.toString() || null,
    }));
  }

  async findOne(id: string) {
    return this.prisma.voucher.findUniqueOrThrow({
      where: { id },
      include: {
        vendor: true,
        category: true,
        bank: true,
        approvals: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  async getApprovalInfo(id: string, actor: { id: string; roles: string[] }) {
    const voucher = await this.findOne(id);
    const limits = await this.getApprovalLimits();

    const parsedLimits = limits.map((l) => ({
      roleCode: l.roleCode,
      rank: l.rank,
      maxAmount: l.maxAmount !== null ? new Decimal(l.maxAmount) : null,
    }));

    let canApprove = false;
    let requiredRole = '';
    try {
      const result = authorizeVoucherApproval(
        {
          id: voucher.id,
          voucherNo: voucher.voucherNo,
          amount: new Decimal(voucher.amount.toString()),
          status: voucher.status,
          raisedById: voucher.raisedById,
          approvedById: voucher.approvedById,
        },
        actor,
        parsedLimits,
      );
      canApprove = true;
      requiredRole = result.requiredRole;
    } catch {
      canApprove = false;
    }

    const routing = requiredApprover(new Decimal(voucher.amount.toString()), parsedLimits);

    return {
      canApprove,
      requiredRole: requiredRole || routing.roleCode,
      routing: {
        roleCode: routing.roleCode,
        rank: routing.rank,
        maxAmount: routing.maxAmount?.toString() || 'unlimited',
      },
    };
  }

  async create(data: z.infer<typeof voucherSchema>, actorId: string) {
    const count = await this.prisma.voucher.count();
    const voucherNo = `MAPA/VCH/${new Date().getFullYear()}/${String(count + 1).padStart(3, '0')}`;

    const amount = new Decimal(data.amount);
    const whtRate = new Decimal(data.whtRate || 0);
    const whtAmount = amount.times(whtRate).dividedBy(100);
    const netAmount = amount.minus(whtAmount);

    const voucher = await this.prisma.voucher.create({
      data: {
        voucherNo,
        date: data.date,
        description: data.description,
        amount: amount.toFixed(4),
        whtRate: whtRate.toFixed(4),
        whtAmount: whtAmount.toFixed(4),
        netAmount: netAmount.toFixed(4),
        vendorId: data.vendorId,
        categoryId: data.categoryId,
        bankId: data.bankId,
        beneficiary: data.beneficiary,
        beneficiaryAccountNo: data.beneficiaryAccountNo,
        status: 'DRAFT',
        raisedById: actorId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'voucher.created',
        entityType: 'Voucher',
        entityId: voucher.id,
        after: { voucherNo, amount: amount.toString(), netAmount: netAmount.toString() } as never,
      },
    });

    // Recalculate budget if linked to active budget
    if (voucher.categoryId) {
      await this.recalculateBudgetForVoucher(voucher);
    }

    return voucher;
  }

  async update(id: string, data: any, actorId: string) {
    const voucher = await this.prisma.voucher.findUniqueOrThrow({ where: { id } });

    if (voucher.status !== 'DRAFT' && voucher.status !== 'REJECTED') {
      throw new BadRequestException('Only draft or rejected vouchers can be edited.');
    }

    let updateData: any = { ...data };
    if (data.amount || data.whtRate !== undefined) {
      const amount = new Decimal(data.amount || voucher.amount.toString());
      const whtRate = new Decimal(data.whtRate !== undefined ? data.whtRate : voucher.whtRate.toString());
      const whtAmount = amount.times(whtRate).dividedBy(100);
      const netAmount = amount.minus(whtAmount);
      updateData.amount = amount.toFixed(4);
      updateData.whtRate = whtRate.toFixed(4);
      updateData.whtAmount = whtAmount.toFixed(4);
      updateData.netAmount = netAmount.toFixed(4);
    }

    const updated = await this.prisma.voucher.update({
      where: { id },
      data: updateData,
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'voucher.updated',
        entityType: 'Voucher',
        entityId: id,
        before: { status: voucher.status } as never,
        after: { status: updated.status } as never,
      },
    });

    // Recalculate budget
    if (updated.categoryId) {
      await this.recalculateBudgetForVoucher(updated);
    }

    return updated;
  }

  async transition(
    id: string,
    action: string,
    actor: { id: string; roles: string[] },
    remarks?: string,
  ) {
    const voucher = await this.prisma.voucher.findUniqueOrThrow({ where: { id } });
    const limits = await this.getApprovalLimits();

    const parsedLimits = limits.map((l) => ({
      roleCode: l.roleCode,
      rank: l.rank,
      maxAmount: l.maxAmount !== null ? new Decimal(l.maxAmount) : null,
    }));

    let fromStatus = voucher.status;
    let toStatus = voucher.status;
    let limitApplied: Decimal | null = null;
    let actorRole = '';

    switch (action) {
      case 'SUBMIT':
        if (voucher.status !== 'DRAFT' && voucher.status !== 'REJECTED') {
          throw new BadRequestException('Only draft or rejected vouchers can be submitted.');
        }
        if (!voucher.vendorId) {
          throw new BadRequestException('Vendor is required before submitting.');
        }
        toStatus = 'PENDING_APPROVAL';
        actorRole = 'RAISER';
        // No approval authorization needed at submission — the raiser is submitting.
        // The required approver will be determined when someone tries to APPROVE.
        break;

      case 'APPROVE': {
        if (voucher.status !== 'PENDING_APPROVAL') {
          throw new BadRequestException('Only pending vouchers can be approved.');
        }
        const result = authorizeVoucherApproval(
          {
            id: voucher.id,
            voucherNo: voucher.voucherNo,
            amount: new Decimal(voucher.amount.toString()),
            status: voucher.status,
            raisedById: voucher.raisedById,
            approvedById: voucher.approvedById,
          },
          actor,
          parsedLimits,
        );
        toStatus = 'APPROVED';
        actorRole = result.approvedUnder.roleCode;
        limitApplied = result.approvedUnder.maxAmount;
        break;
      }

      case 'REJECT':
        if (voucher.status !== 'PENDING_APPROVAL') {
          throw new BadRequestException('Only pending vouchers can be rejected.');
        }
        if (!remarks?.trim()) {
          throw new BadRequestException('Rejection requires a reason.');
        }
        toStatus = 'REJECTED';
        actorRole = 'APPROVER';
        break;

      case 'POST':
        if (voucher.status !== 'APPROVED') {
          throw new BadRequestException('Only approved vouchers can be posted.');
        }
        toStatus = 'POSTED' as any;
        actorRole = 'POSTER';
        break;

      case 'MARK_PAID':
        if (voucher.status !== ('POSTED' as any)) {
          throw new BadRequestException('Only posted vouchers can be marked as paid.');
        }
        toStatus = 'PAID' as any;
        actorRole = 'PAYER';
        break;

      default:
        throw new BadRequestException(`Unknown action: ${action}`);
    }

    // Create approval record
    await this.prisma.voucherApproval.create({
      data: {
        voucherId: id,
        action,
        fromStatus,
        toStatus,
        actorId: actor.id,
        actorRole: actorRole || 'SYSTEM',
        limitApplied: limitApplied?.toFixed(4) || null,
        remarks,
      },
    });

    // Update voucher
    const updated = await this.prisma.voucher.update({
      where: { id },
      data: {
        status: toStatus,
        approvedById: toStatus === 'APPROVED' ? actor.id : undefined,
        approvedAt: toStatus === 'APPROVED' ? new Date() : undefined,
        rejectionReason: toStatus === 'REJECTED' ? remarks : undefined,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: `voucher.${action.toLowerCase()}`,
        entityType: 'Voucher',
        entityId: id,
        after: { status: toStatus } as never,
      },
    });

    // Recalculate budget when status changes
    if (updated.categoryId) {
      await this.recalculateBudgetForVoucher(updated);
    }

    return updated;
  }

  async postToLedger(id: string, actorId: string) {
    const voucher = await this.prisma.voucher.findUniqueOrThrow({
      where: { id },
      include: {
        vendor: true,
        category: true,
      },
    });

    if (voucher.status !== 'APPROVED') {
      throw new BadRequestException('Only approved vouchers can be posted to the ledger.');
    }

    let accountId: string | null = null;
    if (voucher.categoryId) {
      const category = await this.prisma.expenseCategory.findUnique({
        where: { id: voucher.categoryId },
        include: { account: true },
      });
      accountId = category?.accountId || null;
    }

    if (!accountId) {
      throw new BadRequestException(
        'No account is linked to this expense category. Please configure it in settings.'
      );
    }

    let bankAccountId: string | null = null;
    if (voucher.bankId) {
      const bank = await this.prisma.bank.findUnique({
        where: { id: voucher.bankId },
        include: { account: true },
      });
      bankAccountId = bank?.accountId || null;
    }

    if (!bankAccountId) {
      throw new BadRequestException(
        'No account is linked to the selected bank. Please configure it in settings.'
      );
    }

    const period = await this.prisma.fiscalPeriod.findUnique({
      where: {
        year_month: {
          year: voucher.date.getUTCFullYear(),
          month: voucher.date.getUTCMonth() + 1,
        },
      },
    });

    if (!period) {
      throw new BadRequestException('No fiscal period found for this date.');
    }

    if (period.isClosed) {
      throw new BadRequestException('This fiscal period is closed. Cannot post voucher.');
    }

    const amount = new Decimal(voucher.amount.toString());
    const whtAmount = new Decimal(voucher.whtAmount.toString());
    const netAmount = new Decimal(voucher.netAmount.toString());

    const result = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.create({
        data: {
          reference: `JV/${voucher.voucherNo}`,
          date: voucher.date,
          narration: voucher.description,
          sourceType: 'voucher',
          sourceId: voucher.id,
          status: 'POSTED' as any,
          periodId: period.id,
          postedById: actorId,
          postedAt: new Date(),
          lines: {
            create: [
              {
                accountId,
                debit: amount.toFixed(4),
                credit: '0.0000',
                narration: voucher.description,
                sortOrder: 0,
              },
              ...(whtAmount.gt(0)
                ? [
                    {
                      accountId: (
                        await tx.account.findUniqueOrThrow({
                          where: { code: '2240' },
                        })
                      ).id,
                      debit: '0.0000',
                      credit: whtAmount.toFixed(4),
                      narration: 'WHT deducted',
                      sortOrder: 1,
                    },
                  ]
                : []),
              {
                accountId: bankAccountId,
                debit: '0.0000',
                credit: netAmount.toFixed(4),
                narration: `Payment to ${voucher.beneficiary}`,
                sortOrder: 2,
              },
            ],
          },
        },
      });

      await tx.voucher.update({
        where: { id },
        data: { status: 'POSTED' as any },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: 'voucher.posted',
          entityType: 'Voucher',
          entityId: id,
          after: { journalEntryId: entry.id } as never,
        },
      });

      return entry;
    });

    // Recalculate budget after posting
    if (voucher.categoryId) {
      await this.recalculateBudgetForVoucher(voucher);
    }

    return result;
  }

  async remove(id: string, actorId: string) {
    const voucher = await this.prisma.voucher.findUniqueOrThrow({ where: { id } });

    if (voucher.status !== 'DRAFT') {
      throw new BadRequestException('Only draft vouchers can be deleted.');
    }

    const categoryId = voucher.categoryId;

    await this.prisma.voucher.delete({ where: { id } });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'voucher.deleted',
        entityType: 'Voucher',
        entityId: id,
        before: { voucherNo: voucher.voucherNo } as never,
      },
    });

    // Recalculate budget after deletion
    if (categoryId) {
      await this.recalculateBudgetForCategory(categoryId, voucher.date);
    }

    return { ok: true };
  }

  /**
   * Check if a voucher would exceed the budget for its category.
   */
  async checkBudget(categoryId: string, amount: number, date: string) {
    return this.budgets.checkVoucherAgainstBudget(
      categoryId,
      amount,
      new Date(date),
    );
  }

  /**
   * Recalculate budget line amounts after a voucher change.
   */
  private async recalculateBudgetForVoucher(voucher: {
    categoryId: string | null;
    date: Date;
  }) {
    if (!voucher.categoryId) return;
    await this.recalculateBudgetForCategory(voucher.categoryId, voucher.date);
  }

  private async recalculateBudgetForCategory(categoryId: string, date: Date) {
    const year = date.getUTCFullYear();

    const budget = await this.prisma.budget.findFirst({
      where: { year, status: 'ACTIVE' },
    });

    if (!budget) return;

    // Find the budget line for this category
    const line = await this.prisma.budgetLine.findFirst({
      where: { budgetId: budget.id, categoryId },
    });

    if (!line) return;

    // Get all vouchers for this category in the budget year
    const vouchers = await this.prisma.voucher.findMany({
      where: {
        categoryId,
        date: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
    });

    let spent = new Decimal(0);
    let committed = new Decimal(0);

    for (const v of vouchers) {
      const amount = new Decimal(v.amount.toString());
      if (v.status === 'POSTED' || v.status === 'PAID') {
        spent = spent.plus(amount);
      } else if (v.status === 'PENDING_APPROVAL' || v.status === 'APPROVED') {
        committed = committed.plus(amount);
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