# Q Task Manager

Q Task Manager is a multi-tenant SaaS task management platform built for small and mid-sized businesses in Iraq, Kurdistan, and the wider MENA region. It models real company hierarchy (CEO → Manager → Supervisor → Employee) with full audit trails, file versioning, and approval workflows, and ships trilingual from day one — English, Arabic, and Sorani Kurdish — with full RTL support and regional payment methods.

## Workspaces

This is a pnpm monorepo.

- [`apps/api`](apps/api) — NestJS backend (TypeScript, Node 20+)
- [`apps/web`](apps/web) — Next.js 14 frontend (App Router, React 18)

## Getting started

```bash
pnpm install
```

Requires Node.js 20+ and pnpm 9+.

## Environment variables

Copy [`.env.example`](.env.example) to `.env` and fill in real values from your secrets vault. Never commit `.env`.

## Provisioning a Neon dev branch

The team shares a single Neon project; each developer works on their own branch so changes are isolated.

1. Sign in at [console.neon.tech](https://console.neon.tech) and open the `qtm` project.
2. Go to **Branches** → **Create branch**.
3. Pick a name (e.g. `dev-burhan`), set **Parent** to `main`, leave **Compute** as the free-tier default.
4. Region must be **AWS eu-central-1 (Frankfurt)** — set on the project, inherited by branches.
5. Open the new branch → **Connection Details** → copy the connection string into your local `.env` as `DATABASE_URL`.
6. Verify locally:
   ```bash
   psql "$DATABASE_URL" -c "SELECT 1;"
   ```

## Documentation

The product blueprint v2.0 — the single source of truth for scope, schema, and the 21-sprint plan — lives at [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md).

