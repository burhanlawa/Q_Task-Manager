// BullMQ queue name for transactional email sends (Sprint 15.2). Lives in
// its own file to dodge the circular import between email.module (which
// registers + injects @InjectQueue) and the @Processor-decorated worker
// that's loaded by the module.
export const EMAIL_SEND_QUEUE = 'email-send';

// Shape of the payload BullMQ stores per job. Kept lean — the processor
// hands these straight to EmailService.send.
export type EmailSendJob = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /// Resend dedupe key. For notification-driven emails, use notification.id.
  idempotencyKey?: string;
  tags?: Record<string, string>;
};
