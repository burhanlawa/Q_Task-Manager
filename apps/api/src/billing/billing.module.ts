import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { PlanLimitsService } from './plan-limits.service';

// Global so users/, files/, and any future module can inject
// PlanLimitsService without re-importing — same pattern as
// NotificationsModule and ActivityLogModule.
@Global()
@Module({
  controllers: [BillingController],
  providers: [PlanLimitsService],
  exports: [PlanLimitsService],
})
export class BillingModule {}
