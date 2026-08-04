// Pin the process timezone before anything reads a date. Windows machines
// run in local time (WAT here); the VPS runs in UTC. Without this, a payroll
// run prepared locally and one prepared in production could be stamped into
// different fiscal months.
process.env.TZ = 'UTC';

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { ZodExceptionFilter } from './common/zod-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalFilters(new ZodExceptionFilter());
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`API listening on http://localhost:${port}/api`);
}
bootstrap();
