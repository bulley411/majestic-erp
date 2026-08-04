import { Module } from '@nestjs/common';
import { DocumentTypesController, DocumentsController } from './documents.controller';
import { DocumentTypesService } from './document-types.service';
import { DocumentsService } from './documents.service';

@Module({
  controllers: [DocumentTypesController, DocumentsController],
  providers: [DocumentTypesService, DocumentsService],
})
export class DocumentsModule {}