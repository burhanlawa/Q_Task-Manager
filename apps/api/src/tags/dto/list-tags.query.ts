import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class ListTagsQuery {
  // Case-insensitive substring match on name. Empty/missing returns all
  // (within other filters), ordered by usage_count desc then name asc.
  @IsOptional()
  @IsString()
  @Length(1, 100)
  q?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  // Cap response size; the picker doesn't need more than ~25 suggestions.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? parseInt(value, 10) : value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
