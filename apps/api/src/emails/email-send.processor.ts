import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { EMAIL_SEND_QUEUE, type EmailSendJob } from './email.constants';
import { EmailService } from './email.service';

// BullMQ worker that drains the email-send queue. Calls EmailService.send
// and lets BullMQ handle retries.
//
// Retry policy is configured at enqueue time (see add(...) calls): 3
// attempts total, exponential backoff. Here in the processor we only
// distinguish two failure modes:
//   - 4xx-like (validation, bad recipient) → throw UnrecoverableError so
//     BullMQ doesn't retry. Logged for visibility.
//   - 5xx-like (rate limit, Resend outage) → throw normally; BullMQ retries.

@Processor(EMAIL_SEND_QUEUE)
export class EmailSendProcessor extends WorkerHost {
  private readonly log = new Logger(EmailSendProcessor.name);

  constructor(private readonly email: EmailService) {
    super();
  }

  async process(job: Job<EmailSendJob>): Promise<{ messageId: string }> {
    const data = job.data;
    try {
      const { id } = await this.email.send({
        to: data.to,
        subject: data.subject,
        html: data.html,
        text: data.text,
        idempotencyKey: data.idempotencyKey,
        tags: data.tags,
      });
      this.log.log(`Email sent to ${data.to} (resendId=${id}, jobId=${job.id})`);
      return { messageId: id };
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      const isTransient = !e.statusCode || e.statusCode >= 500;
      if (!isTransient) {
        // 4xx → user-error, no point retrying.
        this.log.warn(`Email permanently failed to ${data.to}: ${e.message} (jobId=${job.id})`);
        throw new UnrecoverableError(e.message);
      }
      // 5xx → let BullMQ try again per the attempts/backoff policy.
      this.log.warn(
        `Email transient failure to ${data.to}: ${e.message} ` +
          `(attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1}, jobId=${job.id})`,
      );
      throw err;
    }
  }
}
