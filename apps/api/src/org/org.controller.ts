import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { OrgService } from './org.service';
import { RequirePermissions } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { departmentSchema, jobTitleSchema, gradeLevelSchema } from '@mapa/shared';

const inactive = (v?: string) => v === 'true';

@Controller('departments')
export class DepartmentsController {
  constructor(private org: OrgService) {}

  @Get()
  @RequirePermissions('employee.read')
  findAll(@Query('includeInactive') q?: string) {
    return this.org.departments(inactive(q));
  }

  @Post()
  @RequirePermissions('settings.manage')
  create(@Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.org.createDepartment(departmentSchema.parse(body), actorId);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.org.updateDepartment(id, departmentSchema.partial().parse(body), actorId);
  }

  @Delete(':id')
  @RequirePermissions('settings.manage')
  remove(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.org.removeDepartment(id, actorId);
  }
}

@Controller('job-titles')
export class JobTitlesController {
  constructor(private org: OrgService) {}

  @Get()
  @RequirePermissions('employee.read')
  findAll(@Query('includeInactive') q?: string) {
    return this.org.jobTitles(inactive(q));
  }

  @Post()
  @RequirePermissions('settings.manage')
  create(@Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.org.createJobTitle(jobTitleSchema.parse(body), actorId);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.org.updateJobTitle(id, jobTitleSchema.partial().parse(body), actorId);
  }

  @Delete(':id')
  @RequirePermissions('settings.manage')
  remove(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.org.removeJobTitle(id, actorId);
  }
}

@Controller('grade-levels')
export class GradeLevelsController {
  constructor(private org: OrgService) {}

  @Get()
  @RequirePermissions('employee.read')
  findAll(@Query('includeInactive') q?: string) {
    return this.org.gradeLevels(inactive(q));
  }

  @Post()
  @RequirePermissions('settings.manage')
  create(@Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.org.createGradeLevel(gradeLevelSchema.parse(body), actorId);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.org.updateGradeLevel(id, gradeLevelSchema.partial().parse(body), actorId);
  }

  @Delete(':id')
  @RequirePermissions('settings.manage')
  remove(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.org.removeGradeLevel(id, actorId);
  }
}