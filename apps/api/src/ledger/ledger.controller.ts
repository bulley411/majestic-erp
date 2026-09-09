import { Body, Controller, Get, Param, Patch, Post, Query, HttpCode,Delete } from '@nestjs/common';
import { z } from 'zod';
import { LedgerService } from './ledger.service';
import { ReportsService } from './reports.service';
import { RequirePermissions } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('ledger')
export class LedgerController {
  constructor(
    private ledger: LedgerService,
    private reports: ReportsService,
  ) {}

  /* -------------------- Chart of Accounts -------------------- */

  @Get('accounts')
  @RequirePermissions('ledger.read')
  getAccounts(@Query('includeInactive') includeInactive?: string) {
    return this.ledger.getAccounts(includeInactive === 'true');
  }

  @Get('accounts/tree')
  @RequirePermissions('ledger.read')
  getAccountTree(@Query('includeInactive') includeInactive?: string) {
    return this.ledger.getAccountTree(includeInactive === 'true');
  }

  @Get('accounts/:id')
  @RequirePermissions('ledger.read')
  getAccount(@Param('id') id: string) {
    return this.ledger.getAccount(id);
  }

  @Get('accounts/:id/balance')
  @RequirePermissions('ledger.read')
  getAccountBalance(
    @Param('id') id: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.ledger.getAccountBalance(id, fromDate, toDate);
  }

  /* -------------------- Journal Entries -------------------- */

  @Get('journal-entries')
  @RequirePermissions('ledger.read')
  getJournalEntries(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('status') status?: string,
    @Query('sourceType') sourceType?: string,
  ) {
    return this.ledger.getJournalEntries({ fromDate, toDate, status, sourceType });
  }

  @Get('journal-entries/:id')
  @RequirePermissions('ledger.read')
  getJournalEntry(@Param('id') id: string) {
    return this.ledger.getJournalEntry(id);
  }

  @Post('journal-entries/:id/reverse')
  @HttpCode(200)
  @RequirePermissions('ledger.post')
  reverseJournalEntry(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.ledger.reverseJournalEntry(id, actorId);
  }

  /* -------------------- Trial Balance -------------------- */

  @Get('trial-balance')
  @RequirePermissions('ledger.read')
  getTrialBalance(
    @Query('asAt') asAt?: string,
    @Query('periodId') periodId?: string,
  ) {
    return this.reports.trialBalance(asAt, periodId);
  }

  /* -------------------- Income Statement -------------------- */

  @Get('income-statement')
  @RequirePermissions('ledger.read')
  getIncomeStatement(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('periodId') periodId?: string,
  ) {
    return this.reports.incomeStatement(fromDate, toDate, periodId);
  }

  /* -------------------- Balance Sheet -------------------- */

  @Get('balance-sheet')
  @RequirePermissions('ledger.read')
  getBalanceSheet(
    @Query('asAt') asAt?: string,
    @Query('periodId') periodId?: string,
  ) {
    return this.reports.balanceSheet(asAt, periodId);
  }

  /* -------------------- General Ledger -------------------- */

  @Get('general-ledger')
  @RequirePermissions('ledger.read')
  getGeneralLedger(
    @Query('accountId') accountId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.reports.generalLedger(accountId, fromDate, toDate);
  }

  /* -------------------- Fiscal Periods -------------------- */

  @Get('periods')
  @RequirePermissions('ledger.read')
  getPeriods(@Query('year') year?: string) {
    return this.ledger.getPeriods(year ? Number(year) : undefined);
  }

  @Get('periods/current')
  @RequirePermissions('ledger.read')
  getCurrentPeriod() {
    return this.ledger.getCurrentPeriod();
  }

  @Patch('periods/:id/close')
  @HttpCode(200)
  @RequirePermissions('ledger.close_period')
  closePeriod(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.ledger.closePeriod(id, actorId);
  }

  @Patch('periods/:id/reopen')
  @HttpCode(200)
  @RequirePermissions('ledger.close_period')
  reopenPeriod(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.ledger.reopenPeriod(id, actorId);
  }
  /* -------------------- Chart of Accounts CRUD -------------------- */

@Post('accounts')
@RequirePermissions('ledger.post')
createAccount(@Body() body: unknown, @CurrentUser('sub') actorId: string) {
  return this.ledger.createAccount(body, actorId);
}

@Patch('accounts/:id')
@RequirePermissions('ledger.post')
updateAccount(
  @Param('id') id: string,
  @Body() body: unknown,
  @CurrentUser('sub') actorId: string
) {
  return this.ledger.updateAccount(id, body, actorId);
}

@Delete('accounts/:id')
@RequirePermissions('ledger.post')
deleteAccount(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
  return this.ledger.deleteAccount(id, actorId);
}

@Patch('accounts/:id/toggle')
@RequirePermissions('ledger.post')
toggleAccount(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
  return this.ledger.toggleAccount(id, actorId);
}
}