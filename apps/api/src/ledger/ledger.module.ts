import { Module } from '@nestjs/common';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { ReportsService } from './reports.service';

@Module({
  controllers: [LedgerController],
  providers: [LedgerService, ReportsService],
  exports: [LedgerService],
})
export class LedgerModule {}