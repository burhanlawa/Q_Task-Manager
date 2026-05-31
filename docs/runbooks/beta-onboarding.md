# Beta onboarding runbook (Sprint 21.10)

Walk-through for onboarding 3–5 pre-committed customers as white-glove
beta users. This document is the artifact you walk into each session
with.

## Pre-launch checklist (do once)

Before any beta customer touches the app:

| Gate | Owner | Status |
|---|---|---|
| Operating entity established (UAE / Estonia / US) | Lawa | **BLOCKER** — see followups |
| Counsel sign-off on Terms / Privacy / DPA | Lawa | Pending — Sprint 21.9 |
| Paddle or Stripe merchant account active OR bank-transfer-only beta | Lawa | Blocker on entity |
| Neon owner password rotated | Lawa | ✅ Done 2026-05-31 (F-A05-1) |
| Resend domain verified | Lawa | Pending followup |
| `qtaskmanager.com` domain purchased + DNS configured | Lawa | Pending |
| Sentry alert rules set (any unhandled API exception → email) | Lawa | Pending followup (F-A09-1) |
| CSP + HSTS headers added | Lawa | Pending followup (F-A05-2) |
| `pnpm audit` in CI | Lawa | Pending followup (F-A05-4) |
| Status page (status.qtaskmanager.com) live | Lawa | Pending — Sprint 21.8 dashboard step |
| At least one successful end-to-end test on a clean tenant | Lawa | Recommended pre-customer-1 |

You don't need every row green to start, but rows 1-3 are hard gates if
you're collecting money. Rows 4-6 are launch hygiene.

## Customer pipeline

Track each pre-committed beta customer here. Replace this table as you
go — it's the source of truth during the rollout.

| # | Company | Primary contact | Pre-commit reason | Onboarding date | Status |
|---|---------|-----------------|--------------------|-----------------|--------|
| 1 | _TBD_ | | | | |
| 2 | _TBD_ | | | | |
| 3 | _TBD_ | | | | |
| 4 | _TBD_ | | | | |
| 5 | _TBD_ | | | | |

Status values: `invited` → `signed-up` → `active` → `paying` → `churned`.

The done-check for Sprint 21.10 requires every row to reach **active**
(actively using the app) AND **paying or trial** (real subscription).
Paying via bank-transfer counts. Comped via `scripts/comp-beta-tenant.mjs`
(future, if you decide to comp friends-and-family) counts as trial.

## White-glove session agenda (~45 min per customer)

The session is by video call. You drive their screen during setup;
they take over once their tenant is ready.

### 1. Pre-call (10 min before)

- Confirm the customer's authentication email — they'll sign up with it.
- Have the [Getting Started help doc](../../apps/web/src/app/[locale]/help/page.tsx) open in your other monitor for reference.
- Have your billing-page workflow rehearsed: if they're paying by bank
  transfer, you'll generate the invoice with them on the call.

### 2. Intro (5 min)

- Thank them for being in the beta cohort.
- Set expectations: "You're seeing the product as it is today. We'll
  have bugs. You have a direct line to me — anything you find, I want
  to know." Hand them your support email + Slack channel.
- "We'll be in touch every 2 weeks for the first 6 weeks to collect
  feedback. Cancel anytime."

### 3. Signup (5 min)

- Walk them through `/sign-up`. They enter their work email + password.
- They click the email verification link.
- They land on `/dashboard` as the CEO of their new workspace.
- **Show them the language switcher** (EN / العربية / کوردی) at the top
  right. Confirm their preferred interface language.

### 4. Org structure (10 min)

Depends on their team size:

- **Solo or tiny team (1-3 people):** Skip. The default Executive
  department on the Main branch is enough.
- **Small team with structure (4-15 people):** Create 1-3 departments
  reflecting their actual org (Sales, Operations, etc.). Add a Team or
  two under each if they have working units.
- **Larger / multi-location:** Create the branches first, then
  departments inside each, then teams. Use their org-chart screenshot
  if they shared one ahead of the call.

The goal: by the end of this step their app's structure matches their
mental model. If it doesn't, they'll bounce.

### 5. Invite the first 2-3 teammates (10 min)

- Open People → Invite person.
- For each teammate: name, email, role, branch, department.
- Send the invites live. Watch their phone for the first invite email
  to arrive — confirms our email pipeline works for their domain.
- Their teammates can join asynchronously after the call.

### 6. Create the first task (5 min)

- Open Tasks → New task. Pick a real task from their actual work, not a
  toy example.
- Title, due date, assignee. Save.
- Walk through: the task lands in the assignee's inbox; they accept,
  start, submit; the creator approves; task completes.
- Show the activity log entry that was generated.

### 7. Billing setup (5 min, only if they're paying today)

- Open Billing. Show their current plan + 14-day trial.
- If they want to pay now: walk through `/billing/upgrade` and either:
  - **Card** (if available in their country): one-shot through
    Paddle/Stripe checkout.
  - **Bank transfer**: generate the invoice with them, share the bank
    details, they wire money after the call, submit reference. You
    mark paid once the bank confirms.
- Most beta customers stay on trial for the first 2 weeks — only push
  paying if they raise it.

### 8. Wrap (5 min)

- Show them the Help docs at `/help`.
- Show them the bell (notifications) and how to tune them.
- Show them how to find you: feedback channel (Slack invite, support
  email, or in-app feedback widget once built).
- Confirm: "I'll check in by email in 1 week. Anything urgent, message
  me directly."

## Common pitfalls (you've seen these, customer hasn't)

- **Sign-up form looks broken on dark mode.** Known followup
  (theme-aware Clerk forms). Tell them it's cosmetic; we're fixing it.
- **Invite email goes to spam.** Pre-warm their inbox if you can. After
  Resend domain verification (followup) this gets better.
- **"Where do I see X?"** Always Sidebar → check role visibility. Some
  pages are gated by role (Manager dashboard, Admin dashboard, Roles,
  Billing).
- **Storage limit hit on Starter plan.** Free tier is 1 GB. If they're
  document-heavy, upgrade them to Pro (growth) — bank transfer or comp.
- **"Can I delete a task?"** Tasks can be cancelled, not deleted, by
  design. The activity log is immutable per blueprint § 4.

## Feedback collection

Three channels in order of preference:

1. **Direct email / Slack DM to you.** Beta customers should have your
   direct line; this is the highest-signal channel.
2. **In-app feedback widget** (logged as followup if not built — small
   form at `/feedback`). Lower-friction for issues they want to capture
   in the moment without composing an email.
3. **2-week check-in calls.** 15 min, structured: "What's working?
   What's frustrating? What did you try to do that didn't work?" Take
   notes, file as PRs / issues.

Keep a [docs/runbooks/beta-feedback-log.md](./beta-feedback-log.md)
table — one row per piece of feedback with date, customer, summary,
status (logged / in-progress / shipped / wontfix), commit ref if
shipped.

## Per-customer post-onboarding follow-up

Day 1 (24h after onboarding):
- Email: "How's day 1? Any blockers?"

Day 7:
- Email or DM: "What's working? What's surprising you?"

Day 14 (end of trial):
- If they're activated: nudge to convert to paid or extend trial.
- If they've gone quiet: ask why before they churn.

Day 28:
- Structured feedback session. 30 min video call.
- Output: ranked list of their top 3 wishes / pains, fed back into
  product followups.

## Sign-off

The Sprint 21.10 done-check is: each of the 3-5 beta customers has a
**trial OR paying subscription** AND is **actively using the app**.

| Customer | Subscription | Last login (within 7d?) | Sign-off |
|----------|--------------|--------------------------|----------|
| Customer 1 | ☐ trial / ☐ paying | ☐ yes / ☐ no | _pending_ |
| Customer 2 | ☐ trial / ☐ paying | ☐ yes / ☐ no | _pending_ |
| Customer 3 | ☐ trial / ☐ paying | ☐ yes / ☐ no | _pending_ |
| Customer 4 | ☐ trial / ☐ paying | ☐ yes / ☐ no | _pending_ |
| Customer 5 | ☐ trial / ☐ paying | ☐ yes / ☐ no | _pending_ |

Sprint 21 wraps the MVP. Phase 1.5 begins after sign-off on this row.
