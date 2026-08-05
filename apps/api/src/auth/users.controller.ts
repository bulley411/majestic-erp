import { Body, Controller, Get, Param, Patch, Post, HttpCode } from '@nestjs/common';
import { z } from 'zod';
import { UsersService } from './users.service';
import { RequirePermissions } from './auth.guard';
import { CurrentUser } from './current-user.decorator';

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  roleIds: z.array(z.string().uuid()).min(1, 'Assign at least one role'),
  employeeId: z.string().uuid().optional(),
});

const rolesSchema = z.object({
  roleIds: z.array(z.string().uuid()).min(1),
});

const activeSchema = z.object({ isActive: z.boolean() });

const employeeSchema = z.object({
  employeeId: z.string().uuid().nullable(),
});

@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  @RequirePermissions('user.read')
  findAll() {
    return this.users.findAll();
  }

  /** Declared before :id, or "options" is read as a user id. */
  @Get('options')
  @RequirePermissions('user.read')
  formOptions() {
    return this.users.formOptions();
  }

  @Post()
  @RequirePermissions('user.manage')
  create(@Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.users.create(createSchema.parse(body), actorId);
  }

  @Patch(':id/roles')
  @RequirePermissions('user.manage')
  setRoles(@Param('id') id: string, @Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.users.setRoles(id, rolesSchema.parse(body).roleIds, actorId);
  }

  @Patch(':id/active')
  @RequirePermissions('user.manage')
  setActive(@Param('id') id: string, @Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.users.setActive(id, activeSchema.parse(body).isActive, actorId);
  }

  @Patch(':id/employee')
  @RequirePermissions('user.manage')
  setEmployee(@Param('id') id: string, @Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.users.setEmployee(id, employeeSchema.parse(body).employeeId, actorId);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @RequirePermissions('user.manage')
  resetPassword(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.users.resetPassword(id, actorId);
  }
}