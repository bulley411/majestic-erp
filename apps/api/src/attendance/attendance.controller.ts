import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Res,
  UploadedFile, UseInterceptors, HttpCode, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { AttendanceService } from './attendance.service';
import { RequirePermissions } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const markSchema = z.object({
  entries: z.array(z.object({
    employeeId: z.string().uuid(),
    date: isoDay,
    status: z.enum(['PRESENT','REMOTE','LATE','HALF_DAY','ABSENT','ON_LEAVE','SUSPENDED']),
    checkIn: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    checkOut: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    notes: z.string().max(300).optional(),
  })).min(1),
});

const policySchema = z.object({
  workingDays: z.array(z.number().int().min(0).max(6)).min(1).optional(),
  workStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  workEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  lateGraceMinutes: z.number().int().min(0).max(240).optional(),
  deductionBasis: z.enum(['WORKING_DAYS', 'FIXED_30']).optional(),
  latenessPolicy: z.enum(['NONE', 'HALF_DAY_AFTER', 'PRORATA_MINUTES']).optional(),
  latenessFreeCount: z.number().int().min(0).max(31).optional(),
  lateWarningThreshold: z.number().int().min(1).max(31).optional(),
});

const holidaySchema = z.object({
  date: isoDay,
  name: z.string().trim().min(2).max(80),
});

@Controller('attendance')
export class AttendanceController {
  constructor(private attendance: AttendanceService) {}

  /* ----------------------------- register ---------------------------- */

  @Get('register')
  @RequirePermissions('attendance.read')
  register(@Query('date') date: string) {
    return this.attendance.dailyRegister(isoDay.parse(date));
  }

  @Post('mark')
  @HttpCode(200)
  @RequirePermissions('attendance.write')
  mark(@Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.attendance.mark(markSchema.parse(body).entries, actorId);
  }

  @Post('mark-remaining-present')
  @HttpCode(200)
  @RequirePermissions('attendance.write')
  markRemaining(@Body('date') date: string, @CurrentUser('sub') actorId: string) {
    return this.attendance.markRemainingPresent(isoDay.parse(date), actorId);
  }

  @Get('monthly')
  @RequirePermissions('attendance.read')
  monthly(@Query('year') year: string, @Query('month') month: string) {
    return this.attendance.monthly(Number(year), Number(month));
  }

  /* --------------------------- spreadsheet --------------------------- */

  @Get('template')
  @RequirePermissions('attendance.read')
  async template(
    @Query('year') year: string,
    @Query('month') month: string,
    @Res() res: Response,
  ) {
    const y = Number(year); const m = Number(month);
    if (!y || m < 1 || m > 12) throw new BadRequestException('Invalid period.');
    const buffer = await this.attendance.importTemplate(y, m);
    const name = `attendance-${y}-${String(m).padStart(2, '0')}.xlsx`;
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(buffer);
  }

  @Post('import')
  @HttpCode(200)
  @RequirePermissions('attendance.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  import(
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Body('year') year: string,
    @Body('month') month: string,
    @Body('dryRun') dryRun: string | undefined,
    @CurrentUser('sub') actorId: string,
  ) {
    if (!file) throw new BadRequestException('No file received.');
    return this.attendance.importMonth(
      file.buffer, Number(year), Number(month), actorId, dryRun === 'true',
    );
  }

  /* ---------------------------- settings ----------------------------- */

  @Get('policy')
  @RequirePermissions('attendance.read')
  policy() {
    return this.attendance.policy();
  }

  @Patch('policy')
  @RequirePermissions('settings.manage')
  updatePolicy(@Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.attendance.updatePolicy(policySchema.parse(body), actorId);
  }

  @Get('holidays')
  @RequirePermissions('attendance.read')
  holidays(@Query('year') year?: string) {
    return this.attendance.holidays(year ? Number(year) : undefined);
  }

  @Post('holidays')
  @RequirePermissions('settings.manage')
  addHoliday(@Body() body: unknown, @CurrentUser('sub') actorId: string) {
    const { date, name } = holidaySchema.parse(body);
    return this.attendance.addHoliday(date, name, actorId);
  }

  @Post('holidays/seed')
  @HttpCode(200)
  @RequirePermissions('settings.manage')
  seedHolidays(@Body('year') year: number, @CurrentUser('sub') actorId: string) {
    return this.attendance.seedFixedHolidays(Number(year), actorId);
  }

  @Delete('holidays/:id')
  @RequirePermissions('settings.manage')
  removeHoliday(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.attendance.removeHoliday(id, actorId);
  }
}