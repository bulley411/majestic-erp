import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollRunService } from './payroll-run.service';
import { PayrollPostingService } from './payroll-posting.service';
import { AttendanceModule } from '../attendance/attendance.module';
import { PayrollSettingsService } from './payroll-settings.service';
import { PayrollSettingsController } from './payroll-settings.controller';

@Module({
  imports: [AttendanceModule],
  controllers: [PayrollController, PayrollSettingsController],  // ← Add
  providers: [PayrollRunService, PayrollPostingService, PayrollSettingsService],
  exports: [PayrollPostingService, PayrollSettingsService],
})
export class PayrollModule {}