import { Module } from '@nestjs/common';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { BudgetReportsService } from './budget-reports.service';

@Module({
  controllers: [BudgetsController],
  providers: [BudgetsService, BudgetReportsService],
  exports: [BudgetsService],
})
export class BudgetsModule {}