import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { PayrollSettingsService } from './payroll-settings.service';
import { RequirePermissions } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('payroll/settings')
export class PayrollSettingsController {
  constructor(private settings: PayrollSettingsService) {}

  @Get('accounts')
  @RequirePermissions('settings.manage')
  getAccountMappings() {
    return this.settings.getMappings();
  }

  @Patch('accounts/:key')
  @RequirePermissions('settings.manage')
  setAccountMapping(
    @Param('key') key: string,
    @Body() body: { accountId: string },
    @CurrentUser('sub') actorId: string,
  ) {
    return this.settings.setMapping(key, body.accountId, actorId);
  }
}