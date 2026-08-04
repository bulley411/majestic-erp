import { Module } from '@nestjs/common';
import {
  DepartmentsController, JobTitlesController, GradeLevelsController,
} from './org.controller';
import { OrgService } from './org.service';

@Module({
  controllers: [DepartmentsController, JobTitlesController, GradeLevelsController],
  providers: [OrgService],
})
export class OrgModule {}