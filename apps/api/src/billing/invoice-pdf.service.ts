import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { R2Service } from '../r2/r2.service';

// Sprint 20.5 — Invoice PDF generation.
//
// Renders a billing invoice as a PDF, stores it under R2 at a tenant-
// scoped key, and stamps the row's pdf_r2_key. Generation is on-demand
// (lazy): /billing/invoices/:id/download triggers this if pdf_r2_key
// is null, then streams the bytes. Re-downloads hit the cached R2
// object directly.
//
// Trilingual: en/ar/ckb. We don't pull the i18n bundle from the web
// app — the PDF copy is short and lives here as a static map so the
// API has no cross-app dependency.
//
// RTL: PDFKit doesn't auto-bidi, but it DOES honor OpenType shaping
// when we pass features: ['rtla']. For Arabic/Sorani text we use the
// Noto Sans Arabic TTF (covers both scripts — Sorani uses an extended
// Arabic script set). Layout flips: labels right-aligned, monetary
// values left-aligned (numbers stay LTR even in RTL contexts).

type Locale = 'en' | 'ar' | 'ckb';

const FONT_DIR = join(__dirname, 'fonts');

// PDFKit can only register fonts from a Buffer or file path. We load
// once at module init since these files don't change.
const FONTS = {
  latinRegular: readFileSync(join(FONT_DIR, 'NotoSans-Regular.ttf')),
  latinBold: readFileSync(join(FONT_DIR, 'NotoSans-Bold.ttf')),
  arabicRegular: readFileSync(join(FONT_DIR, 'NotoSansArabic-Regular.ttf')),
  arabicBold: readFileSync(join(FONT_DIR, 'NotoSansArabic-Bold.ttf')),
} as const;

// Per-locale label strings. Keep this in lockstep with billing PDF
// copy elsewhere — there's intentionally no i18n.json since the API
// shouldn't depend on the web app's bundle.
type Strings = {
  invoice: string;
  invoiceNumber: string;
  issuedDate: string;
  status: string;
  paid: string;
  open: string;
  billedTo: string;
  description: string;
  period: string;
  amount: string;
  paymentMethod: string;
  card: string;
  bankTransfer: string;
  paymentReference: string;
  subtotal: string;
  tax: string;
  taxNote: string;
  total: string;
  proSubscription: string;
  thanks: string;
  poweredBy: string;
};

const STRINGS: Record<Locale, Strings> = {
  en: {
    invoice: 'INVOICE',
    invoiceNumber: 'Invoice #',
    issuedDate: 'Issued',
    status: 'Status',
    paid: 'PAID',
    open: 'OPEN',
    billedTo: 'Billed to',
    description: 'Description',
    period: 'Period',
    amount: 'Amount',
    paymentMethod: 'Payment method',
    card: 'Card',
    bankTransfer: 'Bank transfer',
    paymentReference: 'Reference',
    subtotal: 'Subtotal',
    tax: 'Tax',
    taxNote: 'Tax handled by provider (Merchant of Record)',
    total: 'Total',
    proSubscription: 'Q Task Manager — Pro subscription',
    thanks: 'Thank you for using Q Task Manager.',
    poweredBy: 'Powered by Quantum Tech Agency',
  },
  ar: {
    invoice: 'فاتورة',
    invoiceNumber: 'رقم الفاتورة',
    issuedDate: 'تاريخ الإصدار',
    status: 'الحالة',
    paid: 'مدفوعة',
    open: 'معلّقة',
    billedTo: 'فوترة إلى',
    description: 'الوصف',
    period: 'الفترة',
    amount: 'المبلغ',
    paymentMethod: 'طريقة الدفع',
    card: 'بطاقة',
    bankTransfer: 'تحويل بنكي',
    paymentReference: 'المرجع',
    subtotal: 'المجموع الفرعي',
    tax: 'الضريبة',
    taxNote: 'الضريبة يتولاها مزوّد الدفع (تاجر السجل)',
    total: 'الإجمالي',
    proSubscription: 'Q Task Manager — اشتراك Pro',
    thanks: 'شكراً لاستخدامك Q Task Manager.',
    poweredBy: 'مُشغَّل بواسطة Quantum Tech Agency',
  },
  ckb: {
    invoice: 'پسوولە',
    invoiceNumber: 'ژمارەی پسوولە',
    issuedDate: 'بەرواری دەرکردن',
    status: 'دۆخ',
    paid: 'دراوە',
    open: 'چاوەڕێی پارەدان',
    billedTo: 'بۆ',
    description: 'وەسف',
    period: 'ماوە',
    amount: 'بڕ',
    paymentMethod: 'شێوازی پارەدان',
    card: 'کارت',
    bankTransfer: 'گواستنەوەی بانکی',
    paymentReference: 'سەرچاوە',
    subtotal: 'کۆی فەرعی',
    tax: 'باج',
    taxNote: 'باج لەلایەن دابینکەری پارەدانەوە چاودێری دەکرێت',
    total: 'کۆ',
    proSubscription: 'Q Task Manager — بەشداری Pro',
    thanks: 'سوپاس بۆ بەکارهێنانی Q Task Manager.',
    poweredBy: 'بەهۆی Quantum Tech Agency',
  },
};

const RTL_LOCALES: ReadonlySet<Locale> = new Set(['ar', 'ckb']);

type InvoiceWithRelations = {
  id: string;
  companyId: string;
  amountCents: number;
  currency: string;
  status: string;
  paymentMethod: string;
  paymentProvider: string | null;
  paymentReference: string | null;
  pdfR2Key: string | null;
  billedAt: Date | null;
  paidAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  createdAt: Date;
  company: {
    name: string;
    country: string;
    defaultLocale: string;
  };
};

@Injectable()
export class InvoicePdfService {
  private readonly log = new Logger(InvoicePdfService.name);

  constructor(private readonly r2: R2Service) {}

  /**
   * Get the R2 key for an invoice's PDF, generating + uploading if it
   * doesn't exist yet. Idempotent: if pdf_r2_key is already set on the
   * row, returns it without re-rendering. Lives in the billing module
   * (not files/) because invoice PDFs aren't user-domain artifacts.
   */
  async ensurePdf(
    db: Prisma.TransactionClient,
    invoiceId: string,
    companyId: string,
  ): Promise<string> {
    const invoice = (await db.invoice.findFirst({
      where: { id: invoiceId, companyId },
      select: {
        id: true,
        companyId: true,
        amountCents: true,
        currency: true,
        status: true,
        paymentMethod: true,
        paymentProvider: true,
        paymentReference: true,
        pdfR2Key: true,
        billedAt: true,
        paidAt: true,
        periodStart: true,
        periodEnd: true,
        createdAt: true,
        company: {
          select: { name: true, country: true, defaultLocale: true },
        },
      },
    })) as InvoiceWithRelations | null;

    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.pdfR2Key) return invoice.pdfR2Key;

    const buffer = await this.render(invoice);
    // Store under the same {companyId}/invoices/{id}.pdf prefix the
    // file-isolation tests can later be extended to cover. Mirrors the
    // Sprint 11 layout — tenant-scoped paths so even a leaked URL
    // can't be repurposed for an adjacent tenant.
    const key = `${companyId}/invoices/${invoice.id}.pdf`;
    await this.r2.putObject({ key, body: buffer, contentType: 'application/pdf' });
    await db.invoice.update({
      where: { id: invoice.id },
      data: { pdfR2Key: key },
    });
    this.log.log(`Generated invoice PDF ${key} (${buffer.byteLength} bytes)`);
    return key;
  }

  /**
   * Read the PDF bytes back. Caller is expected to have already
   * authorized the request (controller does the RLS check via /:id
   * lookup before calling this).
   */
  async getPdfBytes(key: string): Promise<Buffer> {
    return this.r2.getObject({ key });
  }

  // ----- rendering ---------------------------------------------------

  private async render(invoice: InvoiceWithRelations): Promise<Buffer> {
    const locale = this.resolveLocale(invoice.company.defaultLocale);
    const rtl = RTL_LOCALES.has(locale);
    const s = STRINGS[locale];

    return new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 50,
          info: {
            Title: `Invoice ${invoice.id.slice(0, 8)}`,
            Author: 'Quantum Tech Agency',
            Creator: 'Q Task Manager',
          },
        });

        // Register fonts. PDFKit picks the right one based on which
        // script the text uses; we name them so we can call
        // doc.font('latin-regular') / doc.font('arabic-regular').
        doc.registerFont('latin-regular', FONTS.latinRegular);
        doc.registerFont('latin-bold', FONTS.latinBold);
        doc.registerFont('arabic-regular', FONTS.arabicRegular);
        doc.registerFont('arabic-bold', FONTS.arabicBold);

        // Default to the script the locale uses. Mixed strings (e.g.
        // "Pro" inside Arabic) render fine because Noto fallbacks.
        const fontRegular = rtl ? 'arabic-regular' : 'latin-regular';
        const fontBold = rtl ? 'arabic-bold' : 'latin-bold';

        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        this.drawPage(doc, { invoice, s, rtl, fontRegular, fontBold });
        doc.end();
      } catch (err) {
        reject(err as Error);
      }
    });
  }

  private drawPage(
    doc: PDFKit.PDFDocument,
    ctx: {
      invoice: InvoiceWithRelations;
      s: Strings;
      rtl: boolean;
      fontRegular: string;
      fontBold: string;
    },
  ): void {
    const { invoice, s, rtl, fontRegular, fontBold } = ctx;
    // PDFKit's TextOptions['align'] is typed as a union — narrow each
    // call site to a literal so the overload resolves cleanly.
    const align: 'left' | 'right' = rtl ? 'right' : 'left';
    const opposite: 'left' | 'right' = rtl ? 'left' : 'right';
    // OpenType shaping features: 'rtla' enables right-to-left
    // alternates so Arabic/Sorani ligatures connect correctly.
    const features: PDFKit.Mixins.OpenTypeFeatures[] | undefined = rtl ? ['rtla'] : undefined;

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;

    // --- Header band ------------------------------------------------
    doc
      .font(fontBold)
      .fontSize(24)
      .text(s.invoice, left, 50, { width: pageWidth, align, features });

    doc
      .font(fontRegular)
      .fontSize(10)
      .moveDown(0.5)
      .text(`${s.invoiceNumber}: ${invoice.id.slice(0, 8).toUpperCase()}`, {
        width: pageWidth,
        align,
        features,
      });

    const issuedDate = (invoice.billedAt ?? invoice.createdAt).toISOString().slice(0, 10);
    doc.text(`${s.issuedDate}: ${issuedDate}`, { width: pageWidth, align, features });

    // Status badge — text only (no shape) so RTL layouts don't have to
    // worry about flipping a coloured rectangle.
    const statusLabel = invoice.status === 'paid' ? s.paid : s.open;
    doc
      .font(fontBold)
      .fontSize(11)
      .fillColor(invoice.status === 'paid' ? '#16a34a' : '#d97706')
      .text(`${s.status}: ${statusLabel}`, { width: pageWidth, align, features })
      .fillColor('black');

    doc.moveDown(1.5);

    // --- Billed to --------------------------------------------------
    doc.font(fontBold).fontSize(11).text(s.billedTo, { width: pageWidth, align, features });
    doc
      .font(fontRegular)
      .fontSize(12)
      .text(invoice.company.name, { width: pageWidth, align, features });
    doc.fontSize(10).fillColor('#6b7280').text(invoice.company.country, {
      width: pageWidth,
      align,
      features,
    });
    doc.fillColor('black');

    doc.moveDown(2);

    // --- Line items table ------------------------------------------
    // Two columns: Description (wide) + Amount (narrow). In RTL we
    // keep numbers on the LTR side and labels on the RTL side, which
    // matches how Arabic invoicing conventions render amounts.
    const tableTop = doc.y;
    const amountColWidth = 120;
    const descColWidth = pageWidth - amountColWidth - 10;
    const descX = rtl ? left + amountColWidth + 10 : left;
    const amountX = rtl ? left : left + descColWidth + 10;

    // Header row
    doc.font(fontBold).fontSize(10).fillColor('#6b7280');
    doc.text(s.description, descX, tableTop, { width: descColWidth, align, features });
    doc.text(s.amount, amountX, tableTop, { width: amountColWidth, align: opposite });
    doc
      .moveTo(left, tableTop + 18)
      .lineTo(left + pageWidth, tableTop + 18)
      .stroke('#e5e7eb');
    doc.fillColor('black');

    // Body row — the Pro subscription line. We don't ship multi-line
    // invoices in MVP; one row per invoice (the seat math collapses
    // into a single Pro subscription amount).
    const rowTop = tableTop + 28;
    doc.font(fontRegular).fontSize(11);
    doc.text(s.proSubscription, descX, rowTop, {
      width: descColWidth,
      align,
      features,
    });
    if (invoice.periodStart && invoice.periodEnd) {
      const p = `${invoice.periodStart.toISOString().slice(0, 10)} → ${invoice.periodEnd.toISOString().slice(0, 10)}`;
      doc.fontSize(9).fillColor('#6b7280').text(`${s.period}: ${p}`, descX, doc.y, {
        width: descColWidth,
        align,
        features,
      });
      doc.fillColor('black');
    }

    // Amount (always LTR — monetary values don't bidi-flip).
    doc
      .font(fontRegular)
      .fontSize(11)
      .text(formatMoney(invoice.amountCents, invoice.currency), amountX, rowTop, {
        width: amountColWidth,
        align: opposite,
      });

    // --- Totals -----------------------------------------------------
    const totalsTop = Math.max(doc.y, rowTop) + 40;
    doc
      .moveTo(left, totalsTop - 10)
      .lineTo(left + pageWidth, totalsTop - 10)
      .stroke('#e5e7eb');

    const drawTotalLine = (label: string, value: string, opts: { bold?: boolean } = {}) => {
      const font = opts.bold ? fontBold : fontRegular;
      const size = opts.bold ? 13 : 10;
      doc
        .font(font)
        .fontSize(size)
        .fillColor(opts.bold ? 'black' : '#6b7280');
      const y = doc.y;
      doc.text(label, descX, y, { width: descColWidth, align, features });
      doc.fillColor('black').font(font).fontSize(size);
      doc.text(value, amountX, y, { width: amountColWidth, align: opposite });
      doc.moveDown(0.4);
    };

    doc.y = totalsTop;
    drawTotalLine(s.subtotal, formatMoney(invoice.amountCents, invoice.currency));
    drawTotalLine(s.tax, formatMoney(0, invoice.currency));
    doc.fontSize(8).fillColor('#9ca3af').text(s.taxNote, descX, doc.y, {
      width: descColWidth,
      align,
      features,
    });
    doc.fillColor('black').moveDown(0.6);
    drawTotalLine(s.total, formatMoney(invoice.amountCents, invoice.currency), { bold: true });

    doc.moveDown(2);

    // --- Payment method --------------------------------------------
    doc.font(fontBold).fontSize(11).text(s.paymentMethod, { width: pageWidth, align, features });
    const methodLabel = invoice.paymentMethod === 'bank_transfer' ? s.bankTransfer : s.card;
    doc.font(fontRegular).fontSize(11).text(methodLabel, { width: pageWidth, align, features });
    if (invoice.paymentReference) {
      doc
        .fontSize(10)
        .fillColor('#6b7280')
        .text(`${s.paymentReference}: ${invoice.paymentReference}`, {
          width: pageWidth,
          align,
          features,
        });
      doc.fillColor('black');
    }

    // --- Footer -----------------------------------------------------
    const footerY = doc.page.height - doc.page.margins.bottom - 40;
    doc
      .font(fontRegular)
      .fontSize(9)
      .fillColor('#6b7280')
      .text(s.thanks, left, footerY, { width: pageWidth, align: 'center', features });
    doc.text(s.poweredBy, left, footerY + 14, {
      width: pageWidth,
      align: 'center',
      features,
    });
  }

  private resolveLocale(raw: string): Locale {
    if (raw === 'ar' || raw === 'ckb') return raw;
    return 'en';
  }
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    // Fallback if the currency code is unknown (Stripe ships some odd
    // ISO codes for test mode). Print the raw amount.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
