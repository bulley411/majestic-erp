import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import Decimal from 'decimal.js';
import { z } from 'zod';
@Injectable()
export class VendorsService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: {
    search?: string;
    type?: string;
    includeInactive?: boolean;
  }) {
    const where: any = {};
    
    if (!filters.includeInactive) {
      where.isActive = true;
    }
    
    if (filters.type) {
      where.type = filters.type;
    }
    
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { code: { contains: filters.search, mode: 'insensitive' } },
        { contactPerson: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.vendor.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { vouchers: true },
        },
      },
    });
  }

  async getOptions() {
    return this.prisma.vendor.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    return this.prisma.vendor.findUniqueOrThrow({
      where: { id },
      include: {
        _count: {
          select: { vouchers: true },
        },
      },
    });
  }

  async getBalance(id: string) {
    await this.prisma.vendor.findUniqueOrThrow({ where: { id } });

    // Sum all voucher amounts for this vendor
    const vouchers = await this.prisma.voucher.findMany({
      where: { vendorId: id, status: { in: ['PENDING_APPROVAL', 'APPROVED', 'PAID'] } },
      select: { amount: true, status: true },
    });

    let total = new Decimal(0);
    let paid = new Decimal(0);
    let pending = new Decimal(0);

    for (const v of vouchers) {
      const amount = new Decimal(v.amount.toString());
      total = total.plus(amount);
      if (v.status === 'PAID') {
        paid = paid.plus(amount);
      } else if (v.status === 'PENDING_APPROVAL' || v.status === 'APPROVED') {
        pending = pending.plus(amount);
      }
    }

    return {
      vendorId: id,
      total: total.toFixed(2),
      paid: paid.toFixed(2),
      pending: pending.toFixed(2),
      balance: total.minus(paid).toFixed(2),
    };
  }

  async create(data: z.infer<typeof import('./vendors.controller').vendorSchema>, actorId: string) {
    const clash = await this.prisma.vendor.findFirst({
      where: { code: data.code },
    });
    if (clash) {
      throw new ConflictException(`Vendor code "${data.code}" already exists.`);
    }

    const vendor = await this.prisma.vendor.create({
      data: {
        code: data.code,
        name: data.name,
        type: data.type,
        contactPerson: data.contactPerson,
        email: data.email,
        phone: data.phone,
        address: data.address,
        taxId: data.taxId,
        accountNumber: data.accountNumber,
        bankName: data.bankName,
        accountId: data.accountId,
        isActive: data.isActive,
        notes: data.notes,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'vendor.created',
        entityType: 'Vendor',
        entityId: vendor.id,
        after: { code: vendor.code, name: vendor.name } as never,
      },
    });

    return vendor;
  }

  async update(id: string, data: any, actorId: string) {
    const before = await this.prisma.vendor.findUniqueOrThrow({ where: { id } });

    if (data.code && data.code !== before.code) {
      const clash = await this.prisma.vendor.findFirst({
        where: { code: data.code, id: { not: id } },
      });
      if (clash) {
        throw new ConflictException(`Vendor code "${data.code}" already exists.`);
      }
    }

    const vendor = await this.prisma.vendor.update({
      where: { id },
      data,
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'vendor.updated',
        entityType: 'Vendor',
        entityId: id,
        before: { name: before.name } as never,
        after: { name: vendor.name } as never,
      },
    });

    return vendor;
  }

  async remove(id: string, actorId: string) {
    const vendor = await this.prisma.vendor.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { vouchers: true } } },
    });

    if (vendor._count.vouchers > 0) {
      throw new BadRequestException(
        `${vendor.name} has ${vendor._count.vouchers} voucher(s). ` +
        'Deactivate instead of deleting.'
      );
    }

    await this.prisma.vendor.delete({ where: { id } });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'vendor.deleted',
        entityType: 'Vendor',
        entityId: id,
        before: { name: vendor.name } as never,
      },
    });

    return { ok: true };
  }

  async toggleActive(id: string, actorId: string) {
    const vendor = await this.prisma.vendor.findUniqueOrThrow({ where: { id } });
    const updated = await this.prisma.vendor.update({
      where: { id },
      data: { isActive: !vendor.isActive },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: vendor.isActive ? 'vendor.deactivated' : 'vendor.activated',
        entityType: 'Vendor',
        entityId: id,
        after: { isActive: updated.isActive } as never,
      },
    });

    return updated;
  }
}