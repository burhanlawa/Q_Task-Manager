import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

// PUT /tasks/:id/tags — replace the full tag set.
export class SetTaskTagsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  @Type(() => String)
  tagIds!: string[];
}
