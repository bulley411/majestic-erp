import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './common/prisma.module';
import { PrismaService } from './common/prisma.service';
import { EmployeesModule } from './employees/employees.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard, Public } from './auth/auth.guard';

@Controller('health')
class HealthController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'connected', time: new Date().toISOString() };
  }
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, EmployeesModule],
  controllers: [HealthController],
  // Global. Every route requires a valid token unless marked @Public().
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
