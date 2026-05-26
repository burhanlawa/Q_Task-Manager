-- Sprint 7 task 7.3: per-invite approval state machine.
-- One row per invitee while approval is in flight. Status moves
-- pending → approved | rejected. current_step_index advances through
-- company_settings.onboarding_approval_chain.

CREATE TABLE "user_invitation_approvals" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id"            UUID NOT NULL,
  "invited_user_id"       UUID NOT NULL,
  "invited_by_user_id"    UUID NOT NULL,
  "chain"                 JSONB NOT NULL,
  "current_step_index"    INT NOT NULL DEFAULT 0,
  "status"                TEXT NOT NULL DEFAULT 'pending',
  "decided_at"            TIMESTAMPTZ(6),
  "decided_by_user_id"    UUID,
  "rejection_reason"      TEXT,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

-- One in-flight approval per invited user.
CREATE UNIQUE INDEX "idx_user_invitation_approvals_invited_user_id"
  ON "user_invitation_approvals" ("invited_user_id");

CREATE INDEX "idx_user_invitation_approvals_company_status"
  ON "user_invitation_approvals" ("company_id", "status");

ALTER TABLE "user_invitation_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_invitation_approvals" FORCE ROW LEVEL SECURITY;
CREATE POLICY "user_invitation_approvals_tenant_isolation" ON "user_invitation_approvals"
  USING      (company_id = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON "user_invitation_approvals" TO app_user;

CREATE TRIGGER "user_invitation_approvals_set_updated_at"
  BEFORE UPDATE ON "user_invitation_approvals"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
