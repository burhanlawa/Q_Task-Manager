# Q Task Manager — Product Blueprint v2.0 (Revised Edition)

**Status:** Approved planning, ready to begin development
**Stack:** Node.js · TypeScript · NestJS · PostgreSQL · React · Next.js
**Market:** Iraq · Kurdistan · MENA
**Languages:** Arabic (ar) · Sorani Kurdish (ckb) · English (en)
**Supersedes:** Blueprint v1.0

This document is the single source of truth for Q Task Manager. Revisit it at the start of every sprint and during every major decision. If reality diverges from this plan, update the document — never let it go stale.

---

## 1. Executive Summary

Q Task Manager is a SaaS task management platform built for businesses in Iraq, Kurdistan, and the wider MENA region. It models the way real companies actually work: assignments flow through an organizational hierarchy (CEO → department manager → supervisor → employee), with full audit trails, file versioning, and approval workflows.

Designed from day one with Arabic, Sorani Kurdish, and English support, RTL-ready layout, regional payment methods, and IQD/USD pricing.

### Core MVP Capabilities
- Multi-tenant SaaS with strict company-level data isolation (PostgreSQL RLS)
- Hierarchy: Company → Branches → Departments → (optional) Teams → Employees
- Six built-in roles: CEO, Manager, Supervisor, Employee, HR, Admin
- Full task lifecycle: assign → accept → in progress → submit → approve / revise → complete (+ Request reassignment)
- File uploads with versioning on Cloudflare R2 (PDF/Word/Excel/JPG/PNG)
- Tags, comments with @mentions, partitioned activity log
- In-app + email notifications, fire-and-forget broadcasts
- 3 dashboards in MVP (Employee, Manager, Admin)
- Subscription billing via Paddle (primary) + bank transfer
- Trilingual UI with full RTL support from Sprint 2

### NOT in MVP (deferred)
- Virus scanning (Phase 1.5)
- Subtasks, broadcast ack tracking, recurring tasks, templates (Phase 2)
- Custom date ranges on reports (Phase 2 — presets only in MVP)
- HR/Supervisor/CEO dashboards (Phase 1.5)
- event_outbox + webhooks (Phase 2)
- Local payment integrations FastPay, Qi Card (Phase 2)

### Three rules to honour from day one
1. Every feature works cleanly in 3 languages with RTL
2. Every DB query enforces tenant isolation
3. Every meaningful action is logged to the activity log

---

## 2. Key v2.0 Changes from v1.0

1. **Paddle is primary** payment provider (Merchant of Record); Stripe fallback
2. Virus scanning deferred to Phase 1.5 (column kept)
3. `event_outbox` removed from MVP
4. i18n/RTL scaffolding moved to Sprint 2 (was Sprint 13)
5. Kurdish locale is `ckb` (Sorani, RTL), not `ku`
6. Subtasks deferred to Phase 2 (`parent_task_id` column kept)
7. Broadcast acknowledgement deferred to Phase 2
8. 3 dashboards in MVP, not 6
9. Custom date ranges on reports → Phase 2
10. JPG/PNG allowed on task/comment attachments
11. New "Request reassignment" action (safety valve, not a decline)
12. Tenant-isolation/state-machine/file-access tests pulled forward to Sprints 3, 8, 11
13. `activity_log` partitioned monthly from day one
14. Founder signup auto-grants CEO + Admin + Manager of auto-created "Executive" department
15. Sprint plan expanded to 21 sprints with atomic tasks (~10 months full-time)

---

## 3. Business Model & Pricing

### Plans
| Plan | Users | Storage | Price |
|------|-------|---------|-------|
| Free | Up to 3 | 1 GB total | $0 |
| Pro | Unlimited | 10 GB + 1 GB/user | $5/user/month |
| Enterprise | Unlimited | Custom | Custom |

- **Annual** preferred (15–20% discount); **Monthly** secondary
- Add-on storage: $5/month per 50 GB block
- IQD priced ~50–70% of USD equivalent, displayed separately
- 14-day free trial of Pro, no card required
- Payment: **Paddle (primary)**, Stripe (fallback), manual bank transfer

### Past-due lifecycle
Day 1–7: warning → Day 7–14: read-only → Day 14–30: suspension → Day 30–120: locked → Day 120: deleted

---

## 4. MVP Feature Specification (Summary)

### Entities
- **Company (Tenant)** — top-level, tenant isolation key. Languages: en/ar/ckb. Cannot delete, only archive.
- **Branch** — physical locations. Auto-creates 'Main' branch on signup.
- **Department** — within branch. Auto-creates 'Executive' department on signup; founder is its manager.
- **Team** — optional sub-group, led by Supervisor. Users can be on multiple teams (one primary).
- **User** — org_role (CEO/Manager/Supervisor/Employee) + system_role (HR/Admin) separated. Founder gets CEO + Admin + Manager auto.
- **Task** — core entity. 9 statuses including new `reassignment_requested`. Manager cannot edit after In Progress.
- **File** — Cloudflare R2, versioned, soft-delete only. 50MB max. PDF/Word/Excel/JPG/PNG.
- **Tag** — case-insensitive, per-company, with categories (Priority/Project/Department/Client default)
- **Comment** — rich text, @mentions, attachments, 15-min edit window
- **Notifications** — in-app + email, with TTL (90d default). Per-user prefs.
- **Broadcast** — fire-and-forget in MVP, audience scoped by role
- **Activity Log** — monthly partitioned, immutable (REVOKE UPDATE/DELETE), role-scoped visibility
- **Subscription/Invoice** — Paddle primary, Stripe fallback, manual bank transfer

### Task Status Lifecycle
pending → accepted → in_progress → submitted → (needs_revision | approved → completed)
Side paths: reassignment_requested (new in v2.0), cancelled

### Roles (6 built-in, permissions adjustable)
CEO · Manager · Supervisor · Employee · HR · Admin

---

## 5. Database Schema Highlights

- PostgreSQL 15+, UUID v7 PKs, TIMESTAMPTZ, soft-delete via `deleted_at`
- Every tenant-scoped table has `company_id` + RLS policy
- Key new v2.0 tables/columns:
  - `task_reassignment_requests` (new table)
  - `tasks.reassignment_request_count`, `tasks.assignee_count` (denormalized)
  - `notifications.expires_at` (TTL)
  - `subscriptions.payment_provider`, `paddle_*` columns
  - `company_settings.allow_image_attachments`
  - `activity_log` partitioned monthly by `created_at`
- Removed in v2.0: `event_outbox`, `broadcast_recipients` (MVP)

### Enums
subscription_plan, subscription_status, billing_cycle, user_status, employment_status, leave_status, org_role, task_status (9 values), task_priority, file_purpose, virus_scan_status, notification_channel, broadcast_audience, invoice_status, payment_method, payment_provider

---

## 6. Technical Architecture

| Layer | Choice |
|-------|--------|
| Backend | NestJS + TypeScript (Node 20+) |
| DB | PostgreSQL 15+ on Neon (Frankfurt) |
| ORM | Prisma |
| Frontend | Next.js 14 App Router + React 18 |
| Styling | Tailwind CSS + shadcn/ui (RTL-aware) |
| i18n | next-intl (from Sprint 2) |
| Auth | Clerk |
| Files | Cloudflare R2 |
| Email | Resend |
| Jobs | BullMQ (Redis) |
| Real-time | Pusher |
| Payments | Paddle (primary), Stripe (fallback) |
| Errors | Sentry |
| Analytics | PostHog |
| Hosting | Vercel (web), Railway (api) |

---

## 7. Multi-Tenancy & Security

**Three layers of tenant isolation:**
1. PostgreSQL RLS — `app.current_company_id` session variable
2. Application-level filtering in repositories
3. Authorization checks per endpoint

- Clerk auth, optional TOTP 2FA (recovery codes)
- 5 failed logins / 15 min = 30-min lockout
- AES-256-GCM at app level for `national_id`
- TLS 1.3 everywhere
- Backups: Neon PITR 30d + weekly to R2 separate region 90d
- Pentest before public launch (Sprint 21)

---

## 8. Sprint Plan (21 sprints × 2 weeks = ~10 months full-time)

| Sprint | Weeks | Theme |
|--------|-------|-------|
| 1 | 1–2 | Repo setup, CI, environments, hello-world deploy |
| 2 | 3–4 | DB foundation + RLS + i18n/RTL scaffolding |
| 3 | 5–6 | Auth (Clerk) + tenant context + **isolation tests** |
| 4 | 7–8 | Org structure (branches, departments, teams) |
| 5 | 9–10 | Users + system roles + multi-team |
| 6 | 11–12 | Roles, permissions, founder bootstrap |
| 7 | 13–14 | Onboarding flow |
| 8 | 15–16 | Tasks — schema + CRUD + **state machine tests** |
| 9 | 17–18 | Tasks — full lifecycle + reassignment requests |
| 10 | 19–20 | Tags + due date business-day logic |
| 11 | 21–22 | Files — R2 + upload + download + **tenant tests** |
| 12 | 23–24 | Files — versioning + JPG/PNG + profile files |
| 13 | 25–26 | Comments + @mentions |
| 14 | 27–28 | Notifications — in-app + Pusher real-time |
| 15 | 29–30 | Notifications — email via Resend + preferences + TTL |
| 16 | 31–32 | Broadcasts (fire-and-forget) |
| 17 | 33–34 | Activity log — partitioning + viewer + CSV export |
| 18 | 35–36 | Reports + 3 role dashboards |
| 19 | 37–38 | Subscriptions + Paddle integration |
| 20 | 39–40 | Stripe fallback + bank transfer + invoice PDFs + past-due |
| 21 | 41–42 | Translations (ar, ckb) + native review + pentest + beta launch |

**Three non-negotiable tests:** tenant isolation (S3), task state machine (S8), file access isolation (S11).

Each atomic task is sized for one focused AI conversation with explicit Inputs / Outputs / Done check.

---

## 9. Pre-Development Checklist (before Sprint 1)

- Register domain (qtaskmanager.com)
- **Verify Paddle/Stripe access from operating jurisdiction** — hard prerequisite
- Decide legal entity (UAE free zone / Estonia e-Residency / US)
- Draft ToS, Privacy Policy, DPA
- Market validation: interview 15 companies, secure 3–5 beta customers
- Branding: logo + Arabic-friendly fonts (IBM Plex Sans Arabic, Cairo, Vazirmatn)
- Provision: GitHub, Vercel, Railway, Neon, Cloudflare R2, Clerk, Resend, Paddle, Sentry, PostHog

---

## 10. Phase 1.5 & Phase 2 Backlog

### Phase 1.5 (first 60–90 days)
Virus scanning, Google SSO, Microsoft SSO, HR/Supervisor/CEO dashboards, bug fixes, perf tuning, help docs.

### Phase 2 (months 3–9)
Subtasks UI, broadcast ack tracking, custom date ranges, event_outbox + webhooks, recurring tasks, templates, custom fields, custom roles, threaded comments, push/SMS/WhatsApp notifications, scheduled broadcasts, PDF reports, theming, FastPay/Qi Card, calendar sync, AI features (Claude), Slack/Teams.

---

## 11. Risk Register (top items)

- Scope creep toward HR/ERP — High likelihood, severe impact
- Timeline underestimation — plan for 2× if part-time
- Payment provider unavailable — verify before Sprint 1
- Solo founder burnout — sustainable pace
- Tenant data leak — three layers + tests in S3/S8/S11

---

## Glossary (key terms)

- **Tenant** = one customer company
- **RLS** = PostgreSQL Row-Level Security
- **Org role** vs **System role** — separated for flexibility
- **Sorani (ckb)** = Kurdish in Arabic script, RTL — the Iraqi Kurdistan locale
- **Kurmanji (kmr)** = Latin script, LTR — not in MVP
- **Merchant of Record (MoR)** = Paddle handles tax/invoicing/compliance
- **Atomic task** = sprint sub-task sized for one AI conversation (new in v2.0)
- **Done check** = the observable that proves an atomic task is complete

---

*End of blueprint summary. Full v2.0 source covered all 15 sections including detailed schema (§5), workflows (§8), API design (§9), and per-sprint atomic tasks (§12). Refer back to the original PDF for column-level schema detail when implementing migrations.*
