# Q Task Manager — Pre-Launch Security Audit

**Sprint 21.6 deliverable.** A structured self-audit against OWASP Top 10
(2021) plus targeted reviews of areas where we know the blueprint placed
non-negotiable security controls. This document is the launch-gate
artifact: every **High** or **Critical** finding must be remediated
before public launch.

| Field            | Value                                  |
| ---------------- | -------------------------------------- |
| Audit date       | 2026-05-31                             |
| Auditor          | Self-audit + claude-code-review skill  |
| Codebase commit  | `ab0d682` (perf 21.5, before 21.6)     |
| Scope            | apps/api + apps/web (in-tree code)     |
| Out of scope     | Third-party services (Clerk, R2,        |
|                  | Paddle, Stripe, Resend, Sentry),       |
|                  | infrastructure (Neon, Railway,         |
|                  | Vercel, Cloudflare DNS)                |
| Status           | In progress — see Findings + Log       |

## How to read this document

Findings are categorized by severity:

- **Critical** — must remediate before any external user touches prod.
- **High** — must remediate before public launch; closed-beta okay.
- **Medium** — schedule for first 30 days post-launch.
- **Low** — log as followup; address opportunistically.

The Remediation Log at the bottom tracks each finding by id with
status, owner, commit, and verification step.

## Architectural context

- **Multi-tenant isolation** is enforced at THREE layers:
  1. Application: every controller method takes `@TenantDb()` which
     binds a Prisma transaction with `set_config('app.current_company_id', …)`.
  2. Database: every tenant table has an RLS policy
     `USING (company_id = current_setting('app.current_company_id')::uuid)`.
  3. Application + database: every tenant table FK has `ON DELETE CASCADE`
     through `companies`, so even an admin mistake deletes coherently.
- **Auth** is Clerk-hosted (email + password, MFA optional). We hold
  no passwords. `users.clerk_user_id` links Clerk → our user row.
- **Encryption at rest** for sensitive PII (`national_id`) uses
  AES-256-GCM via `CryptoService` (Sprint 5).
- **File storage** uses Cloudflare R2 with tenant-scoped object keys
  (`{companyId}/...`) + presigned URLs with 5-minute TTL.

Three non-negotiable tests gate every merge:
- **Tenant isolation** (Sprint 3.9, `tenant-isolation.spec.ts`).
- **Task state machine** (Sprint 8.8, `task-state-machine.spec.ts`).
- **File access isolation** (Sprint 11.6, `file-isolation.spec.ts`).

Plus the Sprint 21.4 critical-paths e2e covering the full workflow.

---

## OWASP Top 10 (2021) walkthrough

### A01 — Broken Access Control

**Status: PASS — multi-layer defense.**

| Check | Implementation | Risk |
|---|---|---|
| Tenant isolation | RLS policies on every tenant table + `set_config` in interceptor | LOW — tested by `tenant-isolation.spec.ts` (non-negotiable) |
| Role-based access | `PermissionsGuard` + `@RequirePermissions()` decorators on every write | LOW — guard runs before controller |
| Object-level auth (IDOR) | Every `findUnique`/`update` runs through RLS-scoped client; cross-tenant lookups return null | LOW — tested by file-isolation + tenant-isolation suites |
| Forced browsing | Sidebar gated by `useUserPermissions`; controller is server-authoritative | LOW |
| Privilege escalation | `user_roles` grants logged to `activity_log`; no client-side role flag is trusted | LOW |
| Past-due / read-only enforcement | `BillingStatusGuard` (Sprint 20.7) 402s on writes when tenant is read-only or paused/expired/cancelled | LOW |

**Specific watch-points reviewed:**
- The platform-admin endpoint `POST /billing/invoices/:id/mark-paid` deliberately uses the owner-role client to bypass RLS for cross-tenant ops. Gated by the `platform.billing.review` permission which **no built-in role has** — must be granted manually. The grant action itself is logged (Sprint 6.6 follow-up extended this to user_roles).
- The Sprint 19.2 trial scheduler + 20.6 past-due scheduler both run with the owner client (no tenant context). Both are background workers — no HTTP entry point.

### A02 — Cryptographic Failures

**Status: PASS — minor watch-point.**

| Check | Implementation | Risk |
|---|---|---|
| Encryption at rest (PII) | `CryptoService` AES-256-GCM with key id in `APP_ENCRYPTION_ACTIVE_KEY_ID` env. Field-level on `users.national_id`. | LOW |
| Encryption in transit | All third-party SDKs use HTTPS (Clerk, R2, Paddle, Stripe, Resend, Pusher). Internal API runs behind Vercel/Railway TLS termination. | LOW |
| Password storage | Clerk owns this; we never touch a password. | N/A |
| Webhook signatures | Paddle (HMAC-SHA256 with replay window), Stripe (official `constructEvent`), Clerk (svix verify) all signature-checked before any state change | LOW |
| Stripe-Signature header replay window | 5-min window via Stripe's library | LOW |
| Paddle replay window | 5-min `SIGNATURE_MAX_AGE_SECONDS` in [paddle-webhook.controller.ts](apps/api/src/webhooks/paddle-webhook.controller.ts) | LOW |
| **Key rotation** | No automated key rotation infrastructure. Manual via env vars. | **MEDIUM** — log for Phase 2. |

**Watch-point F-A02-1 (Medium):** `APP_ENCRYPTION_KEYS` env JSON supports multi-key for rotation but there's no documented runbook for actually rotating. If the active key is ever leaked we'd need to manually decrypt+re-encrypt every `national_id`. Acceptable for MVP beta; document a rotation runbook in Phase 1.5.

### A03 — Injection

**Status: PASS — no string-concatenated SQL.**

| Check | Implementation | Risk |
|---|---|---|
| SQL injection | All queries via Prisma (parameterized). Where raw SQL is used (`$executeRaw`, `$queryRaw`) it's via tagged templates which parameterize automatically. | LOW |
| Raw SQL audit | Activity log partitioning + report aggregations use `Prisma.sql` join — every dynamic piece is wrapped in `Prisma.sql\`\`` not string-interpolated. | LOW |
| NoSQL injection | N/A — we don't use a NoSQL store for tenant data. Redis stores cache JSON; keys are app-controlled. | LOW |
| Command injection | No `exec()` / `spawn()` of user-supplied input. Only `archiver`'s ZIP build + the file generators. | LOW |
| XSS | React escapes by default. Email templates use `escapeHtml()` ([apps/api/src/emails/templates/render.ts:106](apps/api/src/emails/templates/render.ts#L106)). No `dangerouslyInnerHTML` outside MDX/markdown rendering. | LOW |
| Email template injection | Variables interpolated as plain text into HTML body; `escapeHtml()` runs on the whole concatenation. | LOW |
| CSV injection ("formula injection") | CSV exports (reports, activity log, 20.9 data export) wrap every cell in `csvCell()` which doubles `"` and quotes. A cell starting with `=` could still trigger Excel formula execution on import. | **LOW** — log followup. |

**Watch-point F-A03-1 (Low):** CSV cells starting with `=`, `+`, `-`, `@`, `\t`, `\r` can trigger Excel formula execution if the user opens the export in Excel. Mitigation: prefix such cells with `'`. Defer to Phase 2 unless a beta customer complains.

### A04 — Insecure Design

**Status: PASS — design choices reviewed.**

| Check | Implementation | Risk |
|---|---|---|
| Threat model documented | This document + blueprint v2.0 §6 architecture | LOW |
| Trial → free conversion abuse | Sprint 19.2 scheduler caps trial to 14 days; no way for a tenant to re-trigger. | LOW |
| Seat exhaustion DoS | Plan-limit gate (Sprint 19.3) refuses invites past plan cap. | LOW |
| Storage exhaustion | Storage-limit gate (Sprint 11.8 / centralized Sprint 19.3) refuses uploads past plan cap. R2 multipart not supported, so a single upload can't bypass the cap. | LOW |
| Hard-delete safety | Tenant deletion (Sprint 20.6) gated by `ALLOW_HARD_DELETE=true` env flag + soft-delete only even then | LOW |
| Past-due lifecycle | Day-120 deletion enqueues; processor refuses if status recovered between enqueue + execution | LOW |

### A05 — Security Misconfiguration

**Status: MIXED — some items pending.**

| Check | Implementation | Risk |
|---|---|---|
| Default credentials | Neon owner password is dev-only sample value (`npg_zgDxSZo2N6Tp` per followups). | **HIGH** — rotate before prod. |
| Production env vars | Documented in `.env.example`; production set via Railway/Vercel | LOW |
| Error messages | Nest's default error formatter doesn't leak stack traces in prod | LOW |
| Security headers | Next.js sets some defaults; Strict-Transport-Security and CSP not explicitly configured | **MEDIUM** |
| Rate limiting | `ThrottlerGuard` in-memory: 60 req/min/IP. Doesn't survive multi-replica or restart. | **MEDIUM** — log to swap to Redis-backed |
| Failed-login lockout | NOT implemented. Clerk handles signin; we don't see passwords. `login_attempts` table exists for future use. | **MEDIUM** — Clerk handles primary; consider account-takeover defense |
| CORS | No custom CORS config; Next.js + Nest defaults | LOW (web is same-origin via proxy) |
| Dependency versions | `pnpm-lock.yaml` pinned. No automated CVE scanning in CI. | **MEDIUM** — log to add `pnpm audit` to CI |

**Critical action item: F-A05-1 (High):** Rotate Neon owner password before prod. The dev value is in chat history.

**F-A05-2 (Medium):** Add CSP + HSTS headers via Next.js `headers()` config + Nest `helmet` middleware.

**F-A05-3 (Medium):** Swap ThrottlerStorageMemory for `ThrottlerStorageRedisService` once multi-replica.

**F-A05-4 (Medium):** Add `pnpm audit --audit-level=high` to CI workflow.

### A06 — Vulnerable and Outdated Components

**Status: PARTIAL — needs audit.**

We don't have automated dependency vulnerability scanning in CI. Manual `pnpm audit` shows the current state.

**F-A06-1 (Medium):** Add `pnpm audit --audit-level=high` step to CI; gate merges on no high/critical CVEs in production dependencies.

**F-A06-2 (Low):** Stripe v22 is current; Paddle SDK not installed (we use the raw HMAC verifier); Clerk v7 is current; Next 14.2 is one major behind (Next 15 stable). Upgrading Next is a Phase 2 task.

### A07 — Identification and Authentication Failures

**Status: PASS — Clerk handles primary, gaps documented.**

| Check | Implementation | Risk |
|---|---|---|
| Password requirements | Clerk-enforced (configurable in their dashboard) | LOW |
| MFA | Clerk-supported, user-opted | LOW (encourage in onboarding) |
| Session management | Clerk JWT, 60s lifetime, our proxy refreshes | LOW |
| Brute force lockout | Clerk handles this | LOW |
| Webhook auth (no Clerk session) | Paddle/Stripe webhooks signature-verify before any state change | LOW |
| Internal admin endpoints | `platform.billing.review` permission (no built-in role grants it) | LOW |

### A08 — Software and Data Integrity Failures

**Status: PASS.**

| Check | Implementation | Risk |
|---|---|---|
| Code signing | npm packages pulled from registry; lockfile pinned | LOW |
| CI/CD pipeline auth | GitHub Actions; secrets in Actions secrets, not committed | LOW |
| Activity log immutability | Sprint 17.3 — `REVOKE UPDATE, DELETE ON activity_log FROM app_user` on the parent and every child partition | LOW |
| Webhook event idempotency | `paddle_webhook_events` + `stripe_webhook_events` tables keyed on event_id; P2002 collision = duplicate delivery | LOW |
| Migration drift | Discovered in 21.5: `idx_tasks_company_status` and `idx_notifications_user_unread` exist in pg_indexes but not in schema.prisma. Functional but the schema isn't authoritative. | LOW — logged |

### A09 — Security Logging and Monitoring Failures

**Status: MIXED.**

| Check | Implementation | Risk |
|---|---|---|
| Activity log for sensitive actions | Sprint 17 partitioned + immutable. Captures: invites, approvals, role grants/revokes, sensitive-field reads, broadcasts, login? | LOW |
| Sentry wired | DSN configured in env, errors auto-reported. Alerts not configured. | **MEDIUM** |
| Webhook delivery log | Per-event row in `*_webhook_events` tables | LOW |
| Successful logins | NOT logged in our DB. Clerk has its own audit log on their side. | **LOW** — fine for MVP |
| Failed logins | `login_attempts` table exists; not populated (Clerk owns the form) | **LOW** — covered by Clerk |
| Slow-query log | Sprint 21.5 added; warn-level on queries ≥ 200ms | LOW |

**F-A09-1 (Medium):** Configure Sentry alert rules: any unhandled API exception → email to operator. Without this, errors accumulate silently in the dashboard.

### A10 — Server-Side Request Forgery (SSRF)

**Status: PASS — no user-supplied URLs are fetched.**

| Check | Implementation | Risk |
|---|---|---|
| Outbound fetch with user input | Avatar/logo/cv uploads go through R2 presigned URLs — we never fetch user-supplied URLs on the server | LOW |
| Webhook URLs | Paddle/Stripe webhooks come TO us; we don't make outbound webhook calls based on user data | LOW |
| Email render | Email content is server-generated from templates; no user-controlled URLs followed | LOW |

---

## Additional non-OWASP checks

### Multi-tenancy invariants (re-verified)

- All four `tenant-isolation.spec.ts` non-negotiables pass: 9/9.
- All five `task-state-machine.spec.ts` invariants pass: 13/13.
- All `file-isolation.spec.ts` cases pass: 5/5.
- `critical-paths.spec.ts` end-to-end pass: 1/1.

Total green: 53 integration tests on the gate.

### PII handling

- `users.national_id` encrypted at rest (AES-256-GCM).
- `users.date_of_birth`, `users.address`, `emergency_contact_*` are NOT encrypted (low sensitivity).
- The Sprint 20.9 data export includes all of these — documented in the export README.txt that `national_id` is unrecoverable without our keys.

### Cross-tenant RLS sanity (manual spot-check)

Verified by [tenant-isolation.spec.ts](apps/api/test/integration/tenant-isolation.spec.ts) on every CI run. No manual action needed.

---

## Findings summary

| ID | Severity | Title | Owner | Status |
|---|---|---|---|---|
| F-A05-1 | **High** | Rotate Neon owner password before prod | user | open |
| F-A02-1 | Medium | No encryption-key rotation runbook | user | open |
| F-A05-2 | Medium | Missing CSP + HSTS headers | dev | open |
| F-A05-3 | Medium | In-memory rate limiter (no Redis) | dev | open |
| F-A05-4 | Medium | `pnpm audit` not in CI | dev | open |
| F-A06-1 | Medium | No automated CVE scanning | dev | open |
| F-A06-2 | Low | Next.js 14 → 15 upgrade | dev | open |
| F-A09-1 | Medium | Sentry alerts not configured | user | open |
| F-A03-1 | Low | CSV formula-injection mitigation | dev | open |

**No Critical findings.** Three of the Medium items overlap (`F-A05-3`, `F-A05-4`, `F-A06-1` are all "tighten CI / runtime hygiene") — collapse during remediation.

## Remediation log

Update this table as items are addressed. Re-run the security review skill after each merge.

| ID | Action taken | Commit | Verified by | Date |
|---|---|---|---|---|
| F-A05-1 | _pending_ | | | |
| F-A05-2 | _pending_ | | | |
| F-A05-3 | _pending — already logged in `[project_followups]` since Sprint 3.8_ | | | |
| F-A05-4 | _pending_ | | | |
| F-A02-1 | _pending — Phase 2_ | | | |
| F-A06-1 | _pending_ | | | |
| F-A06-2 | _pending — Phase 2_ | | | |
| F-A09-1 | _pending_ | | | |
| F-A03-1 | _pending — Phase 2_ | | | |

## How to verify before launch

1. **F-A05-1 (High)** must show Done in this table with a fresh password in Railway/Vercel env, AND the old password rotated out of Neon. This is the ONE gate.
2. F-A05-2, F-A05-4, F-A09-1 should be Done — they're 30-min jobs each.
3. F-A05-3, F-A06-1 can ship behind beta if multi-replica isn't deployed yet.
4. F-A02-1, F-A03-1, F-A06-2 are Phase 2 — keep beta scope honest.

Re-run the audit by:
- `pnpm -r test:integration` (53/53 expected).
- Walk this doc top-to-bottom against any new code in the diff.
- Optionally invoke `/security-review` for an external eye on the current diff.

## Sign-off

| Role          | Name      | Date       | Status                          |
| ------------- | --------- | ---------- | ------------------------------- |
| Auditor       | _pending_ | YYYY-MM-DD | sign here after final review    |
| Owner / launch decision | _pending_ | YYYY-MM-DD | sign here to launch beta |
