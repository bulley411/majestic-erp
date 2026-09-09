import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, HttpCode,
} from '@nestjs/common';
import { z } from 'zod';
import { VendorsService } from './vendors.service';
import { RequirePermissions } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

export const vendorSchema = z.object({
  code: z.string().trim().min(2).max(20).toUpperCase(),
  name: z.string().trim().min(2).max(120),
  type: z.enum(['SUPPLIER', 'CUSTOMER', 'CONSULTANT', 'OTHER']).default('SUPPLIER'),
  contactPerson: z.string().trim().max(80).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  address: z.string().trim().max(255).optional().nullable(),
  taxId: z.string().trim().max(50).optional().nullable(),
  accountNumber: z.string().trim().max(20).optional().nullable(),
  bankName: z.string().trim().max(60).optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().default(true),
  notes: z.string().trim().max(500).optional().nullable(),
});

const updateVendorSchema = vendorSchema.partial();

@Controller('vendors')
export class VendorsController {
  constructor(private vendors: VendorsService) {}

  @Get()
  @RequirePermissions('voucher.read')
  findAll(
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.vendors.findAll({
      search,
      type,
      includeInactive: includeInactive === 'true',
    });
  }

  @Get('options')
  @RequirePermissions('voucher.read')
  getOptions() {
    return this.vendors.getOptions();
  }

  @Get(':id')
  @RequirePermissions('voucher.read')
  findOne(@Param('id') id: string) {
    return this.vendors.findOne(id);
  }

  @Get(':id/balance')
  @RequirePermissions('voucher.read')
  getBalance(@Param('id') id: string) {
    return this.vendors.getBalance(id);
  }

  @Post()
  @RequirePermissions('voucher.raise')
  create(@Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.vendors.create(vendorSchema.parse(body), actorId);
  }

  @Patch(':id')
  @RequirePermissions('voucher.raise')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.vendors.update(id, updateVendorSchema.parse(body), actorId);
  }

  @Delete(':id')
  @RequirePermissions('voucher.raise')
  remove(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.vendors.remove(id, actorId);
  }

  @Patch(':id/activate')
  @HttpCode(200)
  @RequirePermissions('voucher.raise')
  toggleActive(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.vendors.toggleActive(id, actorId);
  }

  @Get('ping')
@RequirePermissions('voucher.read')
ping() {
  return { message: 'Vendors controller is working!' };
}
}