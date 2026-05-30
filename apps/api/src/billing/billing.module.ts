import { Global, Module } from '@nestjs/common';
import { R2Module } from '../r2/r2.module';
import { BankTransferService } from './bank-transfer.service';
import { BillingController } from './billing.controller';
import { InvoicePdfService } from './invoice-pdf.service';
import { PlanLimitsService } from './plan-limits.service';
import { StripeCheckoutService } from './stripe-checkout.service';

// Global so users/, files/, and any future module can inject
// PlanLimitsService without re-importing — same pattern as
// NotificationsModule and ActivityLogModule.
@Global()
@Module({
  imports: [R2Module],
  controllers: [BillingController],
  providers: [PlanLimitsService, StripeCheckoutService, BankTransferService, InvoicePdfService],
  exports: [PlanLimitsService, StripeCheckoutService, BankTransferService, InvoicePdfService],
})
export class BillingModule {}
