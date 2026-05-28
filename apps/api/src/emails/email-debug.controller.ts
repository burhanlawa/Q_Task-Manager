import { InjectQueue } from '@nestjs/bullmq';
import { Body, Controller, HttpCode, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Queue } from 'bullmq';
import { IsEmail, IsOptional, IsString, Length } from 'class-validator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { EMAIL_SEND_QUEUE, type EmailSendJob } from './email.constants';

class DebugEmailDto {
  @IsEmail()
  to!: string;

  @IsString()
  @Length(1, 200)
  subject!: string;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  text?: string;

  @IsOptional()
  @IsString()
  @Length(0, 50000)
  html?: string;
}

// POST /emails/debug-send
//   Used by the 15.2 done check — enqueues a job that the worker drains.
//   Returns immediately with the BullMQ job id; the actual send happens
//   asynchronously and lands in the inbox a moment later. Auth-required so
//   a random external caller can't spam Resend.
@Controller('emails')
@UseGuards(ClerkAuthGuard, PermissionsGuard)
@UseInterceptors(TenantContextInterceptor)
export class EmailDebugController {
  constructor(@InjectQueue(EMAIL_SEND_QUEUE) private readonly queue: Queue) {}

  @Post('debug-send')
  @HttpCode(202)
  async debugSend(@Body() dto: DebugEmailDto): Promise<{ jobId: string }> {
    const html = dto.html ?? `<p>${escapeHtml(dto.text ?? 'Hello from Q Task Manager.')}</p>`;
    const text = dto.text ?? stripHtml(dto.html ?? 'Hello from Q Task Manager.');
    const payload: EmailSendJob = {
      to: dto.to,
      subject: dto.subject,
      html,
      text,
      tags: { source: 'debug' },
    };
    const job = await this.queue.add('send', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 3600, count: 100 },
      removeOnFail: { age: 86_400, count: 100 },
    });
    return { jobId: job.id! };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
