import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { VouchersService } from './vouchers.service';
import { RequirePermissions } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { BudgetsService } from '../budgets/budgets.service';

// --- Schemas ---

export const voucherSchema = z.object({
  date: z.coerce.date(),
  description: z.string().trim().min(3, 'Description is required').max(500),
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  vendorId: z.string().uuid().optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  bankId: z.string().uuid().optional().nullable(),
  beneficiary: z.string().trim().min(2, 'Beneficiary name is required').max(120),
  beneficiaryAccountNo: z.string().trim().max(20).optional().nullable(),
  whtRate: z.coerce.number().min(0).max(10).default(0),
  notes: z.string().trim().max(500).optional().nullable(),
});

const transitionSchema = z.object({
  action: z.enum(['SUBMIT', 'APPROVE', 'REJECT', 'POST', 'MARK_PAID']),
  remarks: z.string().trim().max(500).optional(),
});

@Controller('vouchers')
export class VouchersController {
  constructor(private vouchers: VouchersService,private budgets: BudgetsService) {}

  @Get()
  @RequirePermissions('voucher.read')
  findAll(
    @Query('status') status?: string,
    @Query('vendorId') vendorId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.vouchers.findAll({ status, vendorId, fromDate, toDate });
  }

  @Get('approval-limits')
  @RequirePermissions('voucher.read')
  getApprovalLimits() {
    return this.vouchers.getApprovalLimits();
  }

  @Get(':id')
  @RequirePermissions('voucher.read')
  findOne(@Param('id') id: string) {
    return this.vouchers.findOne(id);
  }

  @Get(':id/approval-info')
  @RequirePermissions('voucher.read')
  getApprovalInfo(@Param('id') id: string, @CurrentUser() user: any) {
    return this.vouchers.getApprovalInfo(id, { id: user.sub, roles: user.roles });
  }

  @Post()
  @RequirePermissions('voucher.raise')
  create(@Body() body: unknown, @CurrentUser('sub') actorId: string) {
    const data = voucherSchema.parse(body);
    return this.vouchers.create(data, actorId);
  }

  @Patch(':id')
  @RequirePermissions('voucher.raise')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser('sub') actorId: string,
  ) {
    const data = voucherSchema.partial().parse(body);
    return this.vouchers.update(id, data, actorId);
  }

  @Post(':id/transition')
  @HttpCode(200)
  @RequirePermissions('voucher.read')
  transition(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: any,
  ) {
    const { action, remarks } = transitionSchema.parse(body);
    return this.vouchers.transition(id, action, { id: user.sub, roles: user.roles }, remarks);
  }

  @Post(':id/post')
  @HttpCode(200)
  @RequirePermissions('ledger.post')
  post(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.vouchers.postToLedger(id, actorId);
  }

  @Delete(':id')
  @RequirePermissions('voucher.raise')
  remove(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.vouchers.remove(id, actorId);
  }

  // In vouchers.controller.ts
@Get('check-budget/:categoryId')
@RequirePermissions('voucher.read')
async checkBudget(
  @Param('categoryId') categoryId: string,
  @Query('amount') amount: string,
  @Query('date') date: string,
) {
  return this.budgets.checkVoucherAgainstBudget(
    categoryId,
    Number(amount),
    date ? new Date(date) : new Date(),
  );
}
}