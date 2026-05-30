-- Sprint 20.4 — invoices fields for the manual bank-transfer flow.
--
-- Three new columns:
--
--   paid_at — when the invoice was actually marked paid. NULL for
--     status='open' (sent but unpaid). For card-rail rows we set this
--     to billed_at on creation so the field is always meaningful when
--     status='paid'; for bank-transfer rows the platform operator sets
--     it on /mark-paid.
--
--   paid_marked_by_user_id — for manual bank-transfer rows, the
--     platform operator who clicked mark-paid. NULL for automatic
--     (card) flows since there's no human in that loop.
--
--   issued_by_user_id — for manual rows, the customer Admin who hit
--     "Pay by bank transfer" and generated the invoice. Lets us trace
--     "who initiated this" without joining audit log.
--
-- All three are nullable + no defaults — back-filling existing rows
-- isn't needed because the column meanings only apply to rows created
-- after this migration.

ALTER TABLE "invoices"
  ADD COLUMN "paid_at"                 timestamptz(6),
  ADD COLUMN "paid_marked_by_user_id"  uuid,
  ADD COLUMN "issued_by_user_id"       uuid;

-- FKs onto users. SET NULL on delete so a departed operator doesn't
-- cascade-delete invoice history.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_paid_marked_by_user_id_fkey"
    FOREIGN KEY ("paid_marked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "invoices_issued_by_user_id_fkey"
    FOREIGN KEY ("issued_by_user_id")      REFERENCES "users"("id") ON DELETE SET NULL;
