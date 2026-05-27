-- Sprint 12.6: per-tenant toggle for image uploads on tasks.
--
-- Default true (permissive) so tenants who never visit the setting get the
-- baseline experience. Admins flip it off when image attachments aren't
-- appropriate for their workflow (e.g., HR-only spaces, regulated industries
-- that require text-only audit trails).
--
-- The toggle only gates image MIMEs on task attachments + submissions.
-- Avatars / logos / id_card photos go through their own purpose-specific
-- allowlists and aren't affected by this flag.
ALTER TABLE "company_settings"
  ADD COLUMN "allow_image_attachments" boolean NOT NULL DEFAULT true;
