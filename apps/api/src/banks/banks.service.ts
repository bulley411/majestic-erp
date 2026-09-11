import {
  Injectable, BadRequestException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class BanksService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.bank.findMany({
      orderBy: { name: 'asc' },
      include: {
        account: { select: { id: true, code: true, name: true } },
        _count: { select: { vouchers: true } },
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.bank.findUniqueOrThrow({
      where: { id },
      include: {
        account: true,
        _count: { select: { vouchers: true } },
      },
    });
  }

  async create(data: { name: string; accountNumber?: string | null; accountId: string }, actorId: string) {
    const clash = await this.prisma.bank.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' } },
    });
    if (clash) throw new ConflictException(`Bank "${data.name}" already exists.`);

    await this.prisma.account.findUniqueOrThrow({ where: { id: data.accountId } });

    const created = await this.prisma.bank.create({
      data: {
        name: data.name,
        accountNumber: data.accountNumber,
        accountId: data.accountId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'bank.created',
        entityType: 'Bank',
        entityId: created.id,
        after: { name: created.name } as never,
      },
    });

    return created;
  }

  async update(id: string, data: any, actorId: string) {
    const before = await this.prisma.bank.findUniqueOrThrow({ where: { id } });

    if (data.accountId) {
      await this.prisma.account.findUniqueOrThrow({ where: { id: data.accountId } });
    }

    const updated = await this.prisma.bank.update({ where: { id }, data });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'bank.updated',
        entityType: 'Bank',
        entityId: id,
        before: { name: before.name } as never,
        after: { name: updated.name } as never,
      },
    });

    return updated;
  }

  async remove(id: string, actorId: string) {
    const bank = await this.prisma.bank.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { vouchers: true } } },
    });

    if (bank._count.vouchers > 0) {
      throw new BadRequestException(
        `"${bank.name}" has ${bank._count.vouchers} voucher(s). Cannot delete.`,
      );
    }

    await this.prisma.bank.delete({ where: { id } });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'bank.deleted',
        entityType: 'Bank',
        entityId: id,
        before: { name: bank.name } as never,
      },
    });

    return { ok: true };
  }
}