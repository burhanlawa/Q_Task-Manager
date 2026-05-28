import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { EmailDebugController } from './email-debug.controller';
import { EmailSendProcessor } from './email-send.processor';
import { EMAIL_SEND_QUEUE } from './email.constants';
import { EmailService } from './email.service';

// Global so any feature module can @InjectQueue(EMAIL_SEND_QUEUE) without
// re-importing. Same pattern as QueueModule for notifications-cleanup.
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: EMAIL_SEND_QUEUE })],
  controllers: [EmailDebugController],
  providers: [EmailService, EmailSendProcessor],
  exports: [EmailService, BullModule],
})
export class EmailModule {}
