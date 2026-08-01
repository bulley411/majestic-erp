import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma.module';
import { PrismaService } from './common/prisma.service';
import { EmployeesModule } from './employees/employees.module';

@Controller('health')
class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'connected', time: new Date().toISOString() };
  }
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, EmployeesModule],
  controllers: [HealthController],
})
export class AppModule {}
