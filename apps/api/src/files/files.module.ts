import { Module } from '@nestjs/common';
import { R2Module } from '../r2/r2.module';
import { FilesController } from './files.controller';

@Module({
  imports: [R2Module],
  controllers: [FilesController],
})
export class FilesModule {}
