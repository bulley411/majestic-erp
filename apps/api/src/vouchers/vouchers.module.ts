import { Module } from '@nestjs/common';
import { VouchersController } from './vouchers.controller';
import { VouchersService } from './vouchers.service';
import { BudgetsModule } from '../budgets/budgets.module';  // ← ADD THIS

@Module({
  imports: [BudgetsModule],  // ← ADD THIS
  controllers: [VouchersController],
  providers: [VouchersService],
  exports: [VouchersService],
})
export class VouchersModule {}