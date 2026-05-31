# Status page runbook (Sprint 21.8)

Public status page at **status.qtaskmanager.com** showing API, Web, and Database uptime. Powered by Better Stack (formerly Better Uptime).

## What's live in code

- `GET /api/v1/health` — liveness only; returns `{ status: 'ok' }`. Cheap, no DB call.
- `GET /api/v1/health?deep=1` — readiness; pings the DB with `SELECT 1` and returns `{ status: 'ok', db: 'ok', dbMs: <number> }`. 503 if the DB round-trip fails.

Two endpoints so Better Stack can drive **separate signals** on the status page:
- The basic `/health` becomes the **API** uptime monitor.
- `/health?deep=1` becomes the **Database** uptime monitor (same HTTP, deeper assertion).
- The web app's root `/` is the **Web** uptime monitor — Next.js returns 200 if the runtime is up.

## Better Stack setup steps

### 1. Sign up
1. Go to https://betterstack.com/uptime and create an account.
2. Free tier covers 10 monitors at 3-minute intervals. We need 3.

### 2. Create the three monitors

**Monitor 1 — API (liveness)**
- URL: `https://api.qtaskmanager.com/api/v1/health`
- Method: GET
- Expected status: 200
- Expected response keyword: `ok`
- Check frequency: 3 minutes (free tier default)
- Regions: pick at least one in Europe (closest to Neon eu-central-1) + one in Middle East if available
- Alert escalation: email to operator

**Monitor 2 — Database (readiness via API)**
- URL: `https://api.qtaskmanager.com/api/v1/health?deep=1`
- Method: GET
- Expected status: 200
- Expected response keyword: `"db":"ok"`
- Check frequency: 3 minutes
- Alert escalation: email to operator (this one wakes you up; DB outages are real)

**Monitor 3 — Web**
- URL: `https://qtaskmanager.com/`
- Method: GET
- Expected status: 200
- Check frequency: 3 minutes
- Alert escalation: email to operator

### 3. Create the status page
1. Better Stack → Status pages → New status page.
2. Name: "Q Task Manager"
3. Subdomain: `status` (gives you `status.betterstack.com/q-task-manager` as the staging URL).
4. Add the three monitors above; rename their public labels to:
   - `API`
   - `Database`
   - `Web app`
5. Brand: upload the company logo, set the primary color to match the app.
6. Enable "Subscribe to updates" so customers can opt in to email alerts on incidents.

### 4. Wire custom domain (status.qtaskmanager.com)
1. Better Stack → Status page → Custom domain → Add `status.qtaskmanager.com`.
2. They give you a CNAME target like `status.betterstack.com`.
3. Cloudflare DNS (or whichever DNS host) → add a CNAME record for `status` pointing at the Better Stack target. Set proxy mode to **DNS only** (Better Stack handles TLS themselves; Cloudflare's proxy will conflict).
4. Wait 1-10 minutes for propagation.
5. Better Stack auto-provisions a TLS cert via Let's Encrypt once DNS resolves.

### 5. Verify
- Visit `https://status.qtaskmanager.com` — should show three green monitors.
- Click each monitor for the detail page (response time history, incident history).
- Trigger a fake incident by temporarily breaking one of the URLs (e.g. point one of the monitors at `/health?deep=1&fake=bad` if you want — or just stop the API briefly). Confirm the monitor flips red within 3 minutes and you get the email alert.

## Cost
- Free tier covers up to 10 monitors + 1 status page. We use 3 + 1.
- If we ever exceed (more environments, more health checks), upgrade is ~$25/mo for the next tier.

## What this gives us

- Public uptime page for beta customers and prospects.
- Email alert within 3-9 minutes of an outage (one missed check + retry).
- Historical uptime data → SLA storytelling for sales (later).
- Free incident publishing — when an outage happens, post an update from the Better Stack dashboard and subscribers get an email.

## What it doesn't give us

- Detailed APM (per-route latency, error rates) — that's Sentry's job.
- Synthetic transaction tests (e.g. "can a user complete signup?") — would need their browser-test tier ($).
- Auth-gated endpoint monitoring — `/health` is intentionally public.

## Followups (post-launch)

- Add a **Pusher health monitor** when real-time matters more (currently best-effort).
- Add a **R2 health monitor** by checking a known-public R2 object (one of the static assets we already serve).
- Wire incident creation to PostHog so SLA reports tie to deployment activity.
