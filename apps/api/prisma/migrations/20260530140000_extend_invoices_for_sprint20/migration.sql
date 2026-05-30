-- Sprint 20.1 — extend invoices for multi-provider + bank transfer + PDFs.
--
-- The Sprint 19.6 migration created invoices with a single, required
-- paddle_transaction_id. That worked for the Paddle-only flow, but
-- Sprint 20 adds three more invoice origins that don't carry a Paddle id:
--
--   1. Stripe invoices (Sprint 20.2 webhook) — have stripe_invoice_id.
--   2. Manual bank transfers (Sprint 20.4) — have neither; just a human
--      reference number written by the CEO/Admin.
--   3. Anything we backfill (e.g. importing legacy receipts) — no
--      provider id at all.
--
-- This migration:
--   a) Renames paddle_transaction_id → paddle_invoice_id. Symmetric with
--      the new stripe_invoice_id column; the actual Paddle object we
--      reference is the transaction, but the table is "invoices" so we
--      use the local concept. The old idx + unique constraint follow.
--   b) Makes paddle_invoice_id NULLABLE. Required for Stripe + manual
--      bank transfer rows. The UNIQUE index becomes a PARTIAL index
--      (WHERE … IS NOT NULL) so multiple NULLs don't collide.
--   c) Adds stripe_invoice_id (nullable, partial-unique) for 20.2.
--   d) Adds payment_provider so we can answer "which provider issued
--      this?" without inferring from which id column is set.
--   e) Adds payment_method so manual bank-transfer rows are
--      distinguishable from card payments (UI cares: card invoices say
--      "Paid via card", bank-transfer rows show the reference).
--   f) Adds payment_reference (nullable text) for the manual flow.
--   g) Adds pdf_r2_key (nullable) for Sprint 20.5 — populated once the
--      PDF generator runs. Nullable because PDFs are generated async;
--      the invoice row exists before the file does.
--
-- All additions are nullable / defaulted, so the 3 existing dev-DB rows
-- migrate cleanly without a backfill pass. NOT NULL on payment_provider
-- is added in a follow-up after we know every existing row has a value.

ALTER TABLE "invoices"
  RENAME COLUMN "paddle_transaction_id" TO "paddle_invoice_id";

ALTER TABLE "invoices"
  ALTER COLUMN "paddle_invoice_id" DROP NOT NULL;

-- Old unique constraint travels with the column rename automatically,
-- but it was a non-partial UNIQUE on a (now-nullable) column. Postgres
-- allows multiple NULLs in a UNIQUE column already (every NULL is
-- distinct), so functionally we're fine. We still drop+recreate as a
-- partial index to make the "applies to provider rows only" intent
-- explicit at the schema level.
DROP INDEX IF EXISTS "idx_invoices_paddle_transaction_id";

CREATE UNIQUE INDEX "idx_invoices_paddle_invoice_id"
  ON "invoices" ("paddle_invoice_id")
  WHERE "paddle_invoice_id" IS NOT NULL;

ALTER TABLE "invoices"
  ADD COLUMN "stripe_invoice_id"  text,
  ADD COLUMN "payment_provider"   "payment_provider",
  ADD COLUMN "payment_method"     "payment_method"  NOT NULL DEFAULT 'card',
  ADD COLUMN "payment_reference"  text,
  ADD COLUMN "pdf_r2_key"         text;

CREATE UNIQUE INDEX "idx_invoices_stripe_invoice_id"
  ON "invoices" ("stripe_invoice_id")
  WHERE "stripe_invoice_id" IS NOT NULL;

-- Backfill payment_provider for the existing Paddle rows so the
-- follow-up NOT NULL migration is safe. Every existing row has a
-- paddle_invoice_id (it was NOT NULL at creation), so this is exact.
UPDATE "invoices"
SET "payment_provider" = 'paddle'
WHERE "payment_provider" IS NULL
  AND "paddle_invoice_id" IS NOT NULL;
