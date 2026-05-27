import { IsOptional, IsString, Length } from 'class-validator';

// Shared body for the 6 state-transition endpoints (Sprint 8.6).
// `note` is captured into the activity_log entry — surfaced as the reason
// for revision/cancellation. A dedicated revision_notes column may land later;
// for MVP, activity_log metadata is the source of truth.
export class TransitionTaskDto {
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  note?: string;
}
