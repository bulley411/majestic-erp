import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res,
  UploadedFile, UseInterceptors, HttpCode, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { EmployeesService } from './employees.service';
import { RequirePermissions } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { employeeCreate, employeeUpdate, compensationSchema  } from '@mapa/shared';
import { MAX_PHOTO_BYTES } from '../documents/storage';

const clientIp = (req: Request) =>
  (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
  ?? req.socket?.remoteAddress;

@Controller('employees')
export class EmployeesController {
  constructor(private employees: EmployeesService) {}

  @Get()
  @RequirePermissions('employee.read')
  findAll(
    @Query('search') search?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
  ) {
    return this.employees.findAll({ search, departmentId, status });
  }

  /** Must be declared before :id, or "options" is read as an id. */
  @Get('options')
  @RequirePermissions('employee.read')
  formOptions() {
    return this.employees.formOptions();
  }

  @Get(':id')
  @RequirePermissions('employee.read')
  findOne(@Param('id') id: string) {
    return this.employees.findOne(id);
  }

  @Get(':id/history')
  @RequirePermissions('employee.write')
  history(@Param('id') id: string) {
    return this.employees.history(id);
  }

  @Post()
  @RequirePermissions('employee.write')
  create(@Body() body: unknown, @CurrentUser('sub') actorId: string, @Req() req: Request) {
    const data = employeeCreate.parse(body);
    return this.employees.create(data, actorId, clientIp(req));
  }
  @Get(':id/compensation')
  @RequirePermissions('employee.read')
  compensation(@Param('id') id: string) {
    return this.employees.compensationHistory(id);
  }

  @Post(':id/compensation')
  @RequirePermissions('employee.write')
  setCompensation(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser('sub') actorId: string,
  ) {
    const data = compensationSchema.parse(body);
    return this.employees.setCompensation(id, data, actorId);
  }
  
  @Post(':id/photo')
  @HttpCode(200)
  @RequirePermissions('employee.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } }))
  setPhoto(
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
    @CurrentUser('sub') actorId: string,
  ) {
    if (!file) throw new BadRequestException('No image received.');
    return this.employees.setPhoto(id, file, actorId);
  }

  @Get(':id/photo')
  @RequirePermissions('employee.read')
  async getPhoto(@Param('id') id: string, @Res() res: Response) {
    const { buffer, mimeType } = await this.employees.getPhoto(id);
    res.setHeader('Content-Type', mimeType);
    // Private: a staff photograph should not be cached by any shared proxy.
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  }

  @Delete(':id/photo')
  @RequirePermissions('employee.write')
  removePhoto(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.employees.removePhoto(id, actorId);
  }
  
  @Patch(':id')
  @RequirePermissions('employee.write')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser('sub') actorId: string,
    @Req() req: Request,
  ) {
    const data = employeeUpdate.parse(body);
    return this.employees.update(id, data, actorId, clientIp(req));
  }
}