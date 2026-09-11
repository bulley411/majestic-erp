import { Body, Controller, Delete, Get, Param, Patch, Post, HttpCode } from '@nestjs/common';
import { z } from 'zod';
import { PayrollRunService } from './payroll-run.service';
import { PayrollPostingService } from './payroll-posting.service';
import { RequirePermissions } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessTokenPayload } from '../auth/tokens';
import { PayrollSettingsService } from './payroll-settings.service';

const createSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

const actionSchema = z.object({
  action: z.enum(['PREPARE', 'REVIEW', 'APPROVE', 'REJECT', 'MARK_PAID']),
  remarks: z.string().trim().max(500).optional(),
});

@Controller('payroll/runs')
export class PayrollController {
  constructor(
    private runs: PayrollRunService,
    private posting: PayrollPostingService,
        private settings: PayrollSettingsService,  // ← Add
  ) {}

  @Get()
  @RequirePermissions('payroll.read')
  list() {
    return this.runs.list();
  }

  @Get(':id')
  @RequirePermissions('payroll.read')
  findOne(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.runs.findOne(id, { id: user.sub, roles: user.roles });
  }

  @Get(':id/payment-schedule')
  @RequirePermissions('payroll.read')
  schedule(@Param('id') id: string) {
    return this.runs.paymentSchedule(id);
  }

  @Post()
  @RequirePermissions('payroll.prepare')
  create(@Body() body: unknown, @CurrentUser('sub') actorId: string) {
    const { year, month } = createSchema.parse(body);
    return this.runs.create(year, month, actorId);
  }

  @Post(':id/transition')
  @HttpCode(200)
  @RequirePermissions('payroll.read')
  transition(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const { action, remarks } = actionSchema.parse(body);
    return this.runs.transition(
      id, action, { id: user.sub, roles: user.roles }, remarks,
    );
  }

  /** Posting is separate: it writes to the ledger and cannot be undone. */
  @Post(':id/post')
  @HttpCode(200)
  @RequirePermissions('payroll.post')
  post(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.posting.post(id, actorId);
  }

  @Delete(':id')
  @RequirePermissions('payroll.prepare')
  discard(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.runs.discard(id, actorId);
  }

@Get('settings/accounts')
  @RequirePermissions('settings.manage')
  getAccountMappings() {
    return this.settings.getMappings();
  }

  @Patch('settings/accounts/:key')
  @RequirePermissions('settings.manage')
  setAccountMapping(
    @Param('key') key: string,
    @Body() body: { accountId: string },
    @CurrentUser('sub') actorId: string,
  ) {
    return this.settings.setMapping(key, body.accountId, actorId);
  }
}