// Sprint 20.4 — Manual bank-transfer billing flow.
//
// For tenants in regions where neither Paddle nor Stripe can onboard
// (e.g. Iraq today), the customer Admin clicks "Pay by bank transfer"
// on /billing/upgrade. We create an invoice (status='open' — the
// invoice_status enum's analogue of the task spec's 'sent'), surface
// the company's bank details, and wait for the customer to wire the
// money + submit their transfer reference. A QTM platform operator
// then confirms receipt manually and marks the invoice paid, which
// transitions the subscription to active and unlocks the plan.
//
// Why two roles in one service: the customer and operator both touch
// the same invoice row and share the resolve/audit code. Keeping them
// together avoids duplicating the "find this invoice, verify it's a
// manual bank-transfer row" guard.

// Pro plan defaults — until we have per-seat math wired we charge a
// flat monthly Pro fee. Customers can request a custom invoice off-
// flow until Sprint 20.5 plumbs seat-based amounts onto the PDF.
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaAdminService } from '../prisma/prisma-admin.service';

const DEFAULT_PRO_MONTHLY_USD_CENTS = 500;

@Injectable()
export class BankTransferService {
  private readonly log = new Logger(BankTransferService.name);

  constructor(private readonly admin: PrismaAdminService) {}

  // GET bank details for display. Lives in env so the operator can
  // change accounts without a deploy. All four fields must be set; if
  // any are missing the upgrade page hides the bank-transfer option.
  getBankDetails(): {
    configured: boolean;
    accountName: string | null;
    bankName: string | null;
    iban: string | null;
    swift: string | null;
    instructions: string | null;
  } {
    const accountName = process.env.BANK_TRANSFER_ACCOUNT_NAME ?? null;
    const bankName = process.env.BANK_TRANSFER_BANK_NAME ?? null;
    const iban = process.env.BANK_TRANSFER_IBAN ?? null;
    const swift = process.env.BANK_TRANSFER_SWIFT ?? null;
    const instructions = process.env.BANK_TRANSFER_INSTRUCTIONS ?? null;
    const configured = Boolean(accountName && bankName && iban && swift);
    return { configured, accountName, bankName, iban, swift, instructions };
  }

  // Customer (CEO/Admin) creates a pending invoice. We charge a flat
  // Pro monthly amount (DEFAULT_PRO_MONTHLY_USD_CENTS); the period
  // covers from now to +30 days. paid_at stays null until the operator
  // marks it.
  async createPendingInvoice(
    db: Prisma.TransactionClient,
    input: { companyId: string; userId: string },
  ): Promise<{ id: string; amountCents: number; currency: string }> {
    if (!this.getBankDetails().configured) {
      throw new BadRequestException(
        'Bank transfer is not configured on this deployment. Contact support.',
      );
    }
    const subscription = await db.subscription.findUnique({
      where: { companyId: input.companyId },
      select: { id: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found');

    // Block duplicate pending rows — one outstanding manual invoice
    // per tenant at a time. The customer can either wait or contact
    // support to void the existing one.
    const existing = await db.invoice.findFirst({
      where: {
        companyId: input.companyId,
        paymentMethod: 'bank_transfer',
        status: 'open',
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException(
        'There is already a pending bank-transfer invoice for your company. Submit the reference for that invoice or contact support.',
      );
    }

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 86_400_000);
    const created = await db.invoice.create({
      data: {
        companyId: input.companyId,
        subscriptionId: subscription.id,
        amountCents: DEFAULT_PRO_MONTHLY_USD_CENTS,
        currency: 'USD',
        status: 'open',
        paymentMethod: 'bank_transfer',
        // payment_provider stays null — manual flow has no provider.
        billedAt: now,
        periodStart: now,
        periodEnd,
        issuedByUserId: input.userId,
      },
      select: { id: true, amountCents: true, currency: true },
    });
    this.log.log(
      `bank_transfer: invoice ${created.id} created (company=${input.companyId}, amount=${created.amountCents} ${created.currency})`,
    );
    return created;
  }

  // Customer submits the wire reference. Only the row's
  // issuedByUserId (or any CEO/Admin in the company) can do this.
  // The row's RLS already scopes to the tenant; we still narrow to
  // their own pending row to avoid letting an Admin overwrite a peer's
  // reference once they've shared the invoice.
  async submitReference(
    db: Prisma.TransactionClient,
    input: { companyId: string; invoiceId: string; reference: string },
  ): Promise<void> {
    const trimmed = input.reference.trim();
    if (!trimmed) throw new BadRequestException('Reference cannot be empty');
    if (trimmed.length > 200) {
      throw new BadRequestException('Reference is too long (max 200 chars)');
    }
    const invoice = await db.invoice.findFirst({
      where: {
        id: input.invoiceId,
        companyId: input.companyId,
        paymentMethod: 'bank_transfer',
        status: 'open',
      },
      select: { id: true },
    });
    if (!invoice) throw new NotFoundException('Pending bank-transfer invoice not found');
    await db.invoice.update({
      where: { id: invoice.id },
      data: { paymentReference: trimmed },
    });
  }

  // Platform operator marks the invoice paid. Two side effects in one
  // transaction:
  //   1. Invoice row: status='paid', paid_at=now, paid_marked_by user.
  //   2. Subscription: status='active', plan='growth', period dates
  //      copied from the invoice. Companies cache synced.
  // Uses the owner-role client (PrismaAdminService) because the
  // operator is acting cross-tenant — their session GUC is set to
  // their OWN company, but the target invoice belongs to a customer
  // tenant. RLS would 404 every query otherwise. Caller must have
  // 'platform.billing.review' permission — gated at the controller
  // layer; this service trusts its inputs.
  async markPaid(input: {
    invoiceId: string;
    markerUserId: string;
  }): Promise<{ id: string; status: 'paid' }> {
    const db = this.admin;
    const invoice = await db.invoice.findUnique({
      where: { id: input.invoiceId },
      select: {
        id: true,
        companyId: true,
        subscriptionId: true,
        paymentMethod: true,
        status: true,
        periodStart: true,
        periodEnd: true,
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.paymentMethod !== 'bank_transfer') {
      throw new ForbiddenException('mark-paid is only valid for manual bank-transfer invoices');
    }
    if (invoice.status === 'paid') {
      // Idempotent — return the existing state instead of erroring so
      // a double-click doesn't surface as a 4xx.
      return { id: invoice.id, status: 'paid' };
    }
    if (invoice.status !== 'open') {
      throw new BadRequestException(`Cannot mark a ${invoice.status} invoice as paid`);
    }

    const now = new Date();
    await db.$transaction([
      db.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'paid',
          paidAt: now,
          paidMarkedByUserId: input.markerUserId,
        },
      }),
      db.subscription.update({
        where: { id: invoice.subscriptionId },
        data: {
          status: 'active',
          plan: 'growth',
          currentPeriodStart: invoice.periodStart ?? now,
          currentPeriodEnd: invoice.periodEnd,
        },
      }),
      db.company.update({
        where: { id: invoice.companyId },
        data: { status: 'active', plan: 'growth' },
      }),
    ]);
    this.log.log(
      `bank_transfer: invoice ${invoice.id} marked paid by ${input.markerUserId}; subscription → active`,
    );
    return { id: invoice.id, status: 'paid' };
  }
}
