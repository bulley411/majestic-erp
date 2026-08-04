import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Res,
  UploadedFile, UseInterceptors, HttpCode, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { DocumentTypesService } from './document-types.service';
import { DocumentsService } from './documents.service';
import { RequirePermissions } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MAX_FILE_BYTES } from './storage';

const categories = ['PRE_EMPLOYMENT', 'ONBOARDING', 'LIFECYCLE', 'EXIT'] as const;

const createTypeSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(120),
  category: z.enum(categories),
  description: z.string().trim().max(300).optional(),
  required: z.boolean().default(true),
  allowMultiple: z.boolean().default(false),
});

const updateTypeSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(300).optional(),
  required: z.boolean().optional(),
  allowMultiple: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

@Controller('document-types')
export class DocumentTypesController {
  constructor(private types: DocumentTypesService) {}

  @Get()
  @RequirePermissions('employee.read')
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.types.findAll(includeInactive === 'true');
  }

  @Post()
  @RequirePermissions('settings.manage')
  create(@Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.types.create(createTypeSchema.parse(body), actorId);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser('sub') actorId: string) {
    return this.types.update(id, updateTypeSchema.parse(body), actorId);
  }

  @Delete(':id')
  @RequirePermissions('settings.manage')
  remove(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.types.remove(id, actorId);
  }
}

@Controller()
export class DocumentsController {
  constructor(private documents: DocumentsService) {}

  @Get('employees/:id/file')
  @RequirePermissions('employee.read')
  employeeFile(@Param('id') id: string) {
    return this.documents.employeeFile(id);
  }

  @Post('employees/:id/file')
  @HttpCode(201)
  @RequirePermissions('employee.document.upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  upload(
    @Param('id') employeeId: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
    @Body('documentTypeId') documentTypeId: string,
    @Body('remarks') remarks: string | undefined,
    @CurrentUser('sub') actorId: string,
  ) {
    if (!file) throw new BadRequestException('No file received.');
    if (!documentTypeId) throw new BadRequestException('Choose a document type.');
    return this.documents.upload(employeeId, documentTypeId, file, actorId, remarks);
  }

  @Get('documents/:documentId/download')
  @RequirePermissions('employee.read')
  async download(@Param('documentId') documentId: string, @Res() res: Response) {
    const { buffer, originalName, mimeType } = await this.documents.download(documentId);
    // attachment, and a quoted filename, so a name containing punctuation
    // cannot break out of the header.
    res.setHeader('Content-Type', mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${originalName.replace(/["\\]/g, '')}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  }

  @Delete('documents/:documentId')
  @RequirePermissions('employee.document.upload')
  remove(@Param('documentId') documentId: string, @CurrentUser('sub') actorId: string) {
    return this.documents.remove(documentId, actorId);
  }
}