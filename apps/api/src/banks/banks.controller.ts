import {
  Body, Controller, Delete, Get, Param, Patch, Post,
} from '@nestjs/common';
import { z } from 'zod';
import { BanksService } from './banks.service';
import { RequirePermissions } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

const bankSchema = z.object({
  name: z.string().trim().min(2).max(60),
  accountNumber: z.string().trim().max(20).optional().nullable(),
  accountId: z.string().uuid('Account is required'),
});

@Controller('banks')
export class BanksController {
  constructor(private banks: BanksService) {}

  @Get()
  @RequirePermissions('voucher.read')
  findAll() {
    return this.banks.findAll();
  }

  @Get(':id')
  @RequirePermissions('voucher.read')
  findOne(@Param('id') id: string) {
    return this.banks.findOne(id);
  }

  @Post()
  @RequirePermissions('settings.manage')
  create(@Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.banks.create(bankSchema.parse(body), actorId);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.banks.update(id, bankSchema.partial().parse(body), actorId);
  }

  @Delete(':id')
  @RequirePermissions('settings.manage')
  remove(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.banks.remove(id, actorId);
  }
}