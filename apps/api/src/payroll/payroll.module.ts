import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollRunService } from './payroll-run.service';
import { PayrollPostingService } from './payroll-posting.service';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [AttendanceModule],
  controllers: [PayrollController],
  providers: [PayrollRunService, PayrollPostingService],
})
export class PayrollModule {}