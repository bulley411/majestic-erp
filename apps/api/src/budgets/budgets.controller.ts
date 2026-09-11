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
} from '@nestjs/common';
import { z } from 'zod';
import { BudgetsService } from './budgets.service';
import { BudgetReportsService } from './budget-reports.service';
import { RequirePermissions } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

export const budgetSchema = z.object({
  name: z.string().trim().min(3).max(120),
  year: z.coerce.number().int().min(2020).max(2100),
  notes: z.string().trim().max(500).optional().nullable(),
  lines: z.array(
    z.object({
      categoryId: z.string().uuid(),
      itemName: z.string().trim().min(2).max(120),
      amountBudgeted: z.coerce.number().nonnegative(),
      notes: z.string().trim().max(300).optional().nullable(),
    }),
  ).min(1, 'At least one budget line is required'),
});

const updateBudgetSchema = budgetSchema.partial();

const statusSchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'CLOSED']),
});

@Controller('budgets')
export class BudgetsController {
  constructor(
    private budgets: BudgetsService,
    private reports: BudgetReportsService,
  ) {}

  @Get()
  @RequirePermissions('budget.read')
  findAll(@Query('year') year?: string, @Query('status') status?: string) {
    return this.budgets.findAll({
      year: year ? Number(year) : undefined,
      status,
    });
  }

  @Get('current')
  @RequirePermissions('budget.read')
  getCurrent() {
    return this.budgets.getCurrent();
  }

  @Get('summary')
  @RequirePermissions('budget.read')
  getSummary(@Query('year') year?: string) {
    return this.reports.budgetSummary(year ? Number(year) : undefined);
  }

  @Get('variance-report')
  @RequirePermissions('budget.read')
  getVarianceReport(@Query('year') year?: string) {
    return this.reports.varianceReport(year ? Number(year) : undefined);
  }

  @Get('monthly-analysis')
  @RequirePermissions('budget.read')
  getMonthlyAnalysis(@Query('year') year?: string) {
    return this.reports.monthlyAnalysis(year ? Number(year) : undefined);
  }

  @Get(':id')
  @RequirePermissions('budget.read')
  findOne(@Param('id') id: string) {
    return this.budgets.findOne(id);
  }

  @Get(':id/vs-actual')
  @RequirePermissions('budget.read')
  getVsActual(@Param('id') id: string) {
    return this.reports.budgetVsActual(id);
  }

  @Post()
  @RequirePermissions('budget.manage')
  create(@Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.budgets.create(budgetSchema.parse(body), actorId);
  }

  @Patch(':id')
  @RequirePermissions('budget.manage')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.budgets.update(id, updateBudgetSchema.parse(body), actorId);
  }

  @Patch(':id/status')
  @HttpCode(200)
  @RequirePermissions('budget.manage')
  setStatus(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.budgets.setStatus(id, statusSchema.parse(body).status, actorId);
  }

  @Delete(':id')
  @RequirePermissions('budget.manage')
  remove(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.budgets.remove(id, actorId);
  }
}