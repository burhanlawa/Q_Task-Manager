import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { EMAIL_SEND_QUEUE, type EmailSendJob } from './email.constants';
import { EmailTemplateService } from './templates/render';
import type { EmailableType, Locale } from './templates/types';

const ALL_TYPES: EmailableType[] = [
  'task_assigned',
  'task_submitted',
  'task_approved',
  'task_revision_requested',
  'task_cancelled',
  'task_reassignment_requested',
  'comment_mentioned',
  'comment_created',
  'deadline_approaching',
  'overdue',
  'onboarding_approval',
  'new_employee',
  'leave_reminder',
];
const ALL_LOCALES: Locale[] = ['en', 'ar', 'ckb'];

// Demo vars used for previews + render-all test sends. Realistic enough
// that the result looks like a real email; never used in production sends.
const DEMO_VARS = {
  recipientName: 'Burhan',
  actorName: 'Sara',
  taskTitle: 'Design review for the dashboard',
  dueDate: 'Friday, 5 June',
  companyName: 'Acme Co.',
  newUserName: 'Lana',
  leaveDate: 'Monday, 8 June',
};

class RenderAllDto {
  @IsEmail()
  to!: string;

  // Optional: limit to one type. Default = send all 13.
  @IsOptional()
  @IsString()
  type?: string;

  // Optional: limit to one locale. Default = send all 3.
  @IsOptional()
  @IsIn(ALL_LOCALES)
  locale?: Locale;
}

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
  constructor(
    @InjectQueue(EMAIL_SEND_QUEUE) private readonly queue: Queue,
    private readonly templates: EmailTemplateService,
  ) {}

  // GET /emails/render-preview?type=task_assigned&locale=ar
  //   Returns the rendered HTML directly so you can view it in the browser.
  //   Auth-required so this isn't an open template-leak endpoint.
  @Get('render-preview')
  @Header('content-type', 'text/html; charset=utf-8')
  renderPreview(@Query('type') type?: string, @Query('locale') locale?: string): string {
    const t = (type ?? 'task_assigned') as EmailableType;
    const l = (locale ?? 'en') as Locale;
    if (!ALL_TYPES.includes(t)) throw new BadRequestException(`Unknown type: ${type}`);
    if (!ALL_LOCALES.includes(l)) throw new BadRequestException(`Unknown locale: ${locale}`);
    return this.templates.render(t, l, DEMO_VARS).html;
  }

  // POST /emails/render-test  body: { to, type?, locale? }
  //   Used by the 15.3 done check. Sends one email per (type × locale)
  //   combination using demo vars. Skips combos when filters are set.
  //   With no filters: 13 × 3 = 39 emails, all to the same inbox so the
  //   sandbox stays inside its delivery rule.
  @Post('render-test')
  @HttpCode(202)
  async renderAll(@Body() dto: RenderAllDto): Promise<{ enqueued: number }> {
    const types = dto.type ? [dto.type as EmailableType] : ALL_TYPES;
    const locales = dto.locale ? [dto.locale] : ALL_LOCALES;
    if (dto.type && !ALL_TYPES.includes(dto.type as EmailableType)) {
      throw new BadRequestException(`Unknown type: ${dto.type}`);
    }
    let enqueued = 0;
    for (const t of types) {
      for (const l of locales) {
        const rendered = this.templates.render(t, l, DEMO_VARS);
        const payload: EmailSendJob = {
          to: dto.to,
          subject: `[${l}] ${rendered.subject}`,
          html: rendered.html,
          text: rendered.text,
          tags: { source: 'render-test', type: t, locale: l },
        };
        await this.queue.add('send', payload, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: { age: 3600, count: 200 },
          removeOnFail: { age: 86_400, count: 100 },
        });
        enqueued++;
      }
    }
    return { enqueued };
  }

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
