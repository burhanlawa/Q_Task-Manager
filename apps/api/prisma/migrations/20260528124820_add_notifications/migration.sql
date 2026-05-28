-- Sprint 14.1: notifications + user_notification_preferences.
--
-- Notifications are per-recipient. We scope them in two layers:
--   1. company_id matches the tenant (same shape as every other table)
--   2. user_id matches the caller — bound via app.current_user_id, set by
--      the tenant interceptor alongside app.current_company_id.
-- Either layer alone would leak across users; together they give a strict
-- "only I see my own" guarantee even if a controller forgets a filter.
--
-- expires_at carries a 90-day TTL per blueprint v2.0. Default is set by a
-- BEFORE INSERT trigger so the app never has to remember; a future cron
-- can DELETE WHERE expires_at < now() without coordinating with code.

CREATE TABLE "notifications" (
  "id"                     uuid           NOT NULL DEFAULT gen_random_uuid(),
  "company_id"             uuid           NOT NULL,
  "user_id"                uuid           NOT NULL,
  -- Short token identifying the event kind ('task_assigned',
  -- 'comment_mentioned', 'task_status_changed', etc.). The UI renders the
  -- body in the active locale based on this + metadata, so we never store
  -- pre-translated text.
  "type"                   text           NOT NULL,
  -- Optional fallback title/body the API may set when no localized
  -- renderer is available. NULL when type alone + metadata suffices.
  "title"                  text,
  "body"                   text,
  -- Deep link the UI navigates to on click. Stored as a path (no host).
  "link"                   text,
  -- Who triggered the event (NULL for system-generated).
  "source_actor_user_id"   uuid,
  -- What entity the event is about, polymorphically ('task' | 'comment' | ...).
  "source_target_type"     text,
  "source_target_id"       uuid,
  -- Free-form data for the UI renderer (e.g., the comment's body excerpt,
  -- the task's title, the mention author's display name).
  "metadata"               jsonb          NOT NULL DEFAULT '{}'::jsonb,
  "read_at"                timestamptz(6),
  "expires_at"             timestamptz(6) NOT NULL DEFAULT (now() + interval '90 days'),
  "created_at"             timestamptz(6) NOT NULL DEFAULT now(),

  CONSTRAINT "notifications_pkey"               PRIMARY KEY ("id"),
  CONSTRAINT "notifications_company_id_fkey"
    FOREIGN KEY ("company_id")            REFERENCES "companies"("id") ON DELETE Cascade,
  CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id")               REFERENCES "users"("id")     ON DELETE Cascade,
  CONSTRAINT "notifications_actor_user_id_fkey"
    FOREIGN KEY ("source_actor_user_id")  REFERENCES "users"("id")     ON DELETE SET NULL
);

-- The bread-and-butter query: "my inbox, newest first." Queries add the
-- WHERE expires_at > now() filter at read time; Postgres can't put now()
-- in a partial index predicate because now() isn't IMMUTABLE.
CREATE INDEX "idx_notifications_user_created"
  ON "notifications" ("user_id", "created_at" DESC);

-- Fast unread-count query for the header badge. read_at IS NULL is
-- immutable so it can live in the predicate.
CREATE INDEX "idx_notifications_user_unread"
  ON "notifications" ("user_id")
  WHERE read_at IS NULL;

-- "All notifications about task X" query.
CREATE INDEX "idx_notifications_target"
  ON "notifications" ("source_target_type", "source_target_id")
  WHERE source_target_id IS NOT NULL;

-- The TTL sweep query: DELETE WHERE expires_at < now().
CREATE INDEX "idx_notifications_expires"
  ON "notifications" ("expires_at");

-- Tenant + per-user RLS. The two-column policy is the actual security
-- boundary; either column alone would leak.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;

CREATE POLICY "notifications_recipient_isolation" ON "notifications"
  USING (
    company_id = current_setting('app.current_company_id', true)::uuid
    AND user_id = current_setting('app.current_user_id', true)::uuid
  )
  WITH CHECK (
    company_id = current_setting('app.current_company_id', true)::uuid
  );
-- The WITH CHECK omits user_id so the dispatch service can insert rows
-- for other users in the same tenant (notifying someone else of an event
-- you triggered). RLS still hides their rows from your reads.

GRANT SELECT, INSERT, UPDATE, DELETE ON "notifications" TO app_user;

-- Default expires_at = now() + 90 days. The column DEFAULT handles inserts
-- that omit expires_at; this trigger catches the case where the app passes
-- a NULL explicitly. Done-check anchors on this so we cover both paths.
CREATE OR REPLACE FUNCTION set_notification_expires_at() RETURNS trigger AS $$
BEGIN
  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := now() + interval '90 days';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notifications_set_expires_at
  BEFORE INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION set_notification_expires_at();

-- ---------------- user_notification_preferences ----------------
-- One row per user. The 'preferences' Json blob holds the per-event-type
-- opt-in/out map so we can add new event types without a migration each
-- time. Schema in JSON: { "<type>": { "in_app": bool, "email": bool, ... } }

CREATE TABLE "user_notification_preferences" (
  "id"           uuid           NOT NULL DEFAULT gen_random_uuid(),
  "company_id"   uuid           NOT NULL,
  "user_id"      uuid           NOT NULL,
  "preferences"  jsonb          NOT NULL DEFAULT '{}'::jsonb,
  "created_at"   timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at"   timestamptz(6) NOT NULL DEFAULT now(),

  CONSTRAINT "user_notification_preferences_pkey"        PRIMARY KEY ("id"),
  -- One prefs row per user; upsert path uses this.
  CONSTRAINT "user_notification_preferences_user_unique" UNIQUE ("user_id"),
  CONSTRAINT "user_notification_preferences_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE Cascade,
  CONSTRAINT "user_notification_preferences_user_id_fkey"
    FOREIGN KEY ("user_id")    REFERENCES "users"("id")     ON DELETE Cascade
);

-- Tenant + per-user RLS — same shape as notifications.
ALTER TABLE "user_notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_notification_preferences" FORCE ROW LEVEL SECURITY;

CREATE POLICY "user_notification_preferences_owner_isolation" ON "user_notification_preferences"
  USING (
    company_id = current_setting('app.current_company_id', true)::uuid
    AND user_id = current_setting('app.current_user_id', true)::uuid
  )
  WITH CHECK (
    company_id = current_setting('app.current_company_id', true)::uuid
    AND user_id = current_setting('app.current_user_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "user_notification_preferences" TO app_user;

-- updated_at trigger uses the existing global set_updated_at() function.
CREATE TRIGGER trg_user_notification_preferences_set_updated_at
  BEFORE UPDATE ON "user_notification_preferences"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
