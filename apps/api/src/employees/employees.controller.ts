import { Controller, Get, Param, Query } from '@nestjs/common';
import { EmployeesService } from './employees.service';

@Controller('employees')
export class EmployeesController {
  constructor(private employees: EmployeesService) {}

  @Get()
  findAll(@Query('search') search?: string, @Query('departmentId') departmentId?: string) {
    return this.employees.findAll({ search, departmentId });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.employees.findOne(id);
  }
}
