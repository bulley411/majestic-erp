import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query,
} from '@nestjs/common';
import { z } from 'zod';
import { ExpenseCategoriesService } from './expense-categories.service';
import { RequirePermissions } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

export const expenseCategorySchema = z.object({
  code: z.string().trim().min(2).max(20).toUpperCase(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(300).optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().default(true),
});

export const updateExpenseCategorySchema = expenseCategorySchema.partial();

@Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(private categories: ExpenseCategoriesService) {}

  @Get()
  @RequirePermissions('voucher.read')
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.categories.findAll(includeInactive === 'true');
  }

  @Get('options')
  @RequirePermissions('voucher.read')
  getOptions() {
    return this.categories.getOptions();
  }

  @Get(':id')
  @RequirePermissions('voucher.read')
  findOne(@Param('id') id: string) {
    return this.categories.findOne(id);
  }

  @Post()
  @RequirePermissions('settings.manage')
  create(@Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.categories.create(expenseCategorySchema.parse(body), actorId);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.categories.update(id, updateExpenseCategorySchema.parse(body), actorId);
  }

  @Delete(':id')
  @RequirePermissions('settings.manage')
  remove(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.categories.remove(id, actorId);
  }
}