import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { MentionParserService } from './mention-parser.service';

@Module({
  controllers: [CommentsController],
  providers: [MentionParserService],
  exports: [MentionParserService],
})
export class CommentsModule {}
