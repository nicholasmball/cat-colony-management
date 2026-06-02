# SCoT Colony Management

Mobile-first web app (PWA) to manage feral cat colonies, feeding operations and
incident reporting for **Street Cats of Tavira**. See `CLAUDE.md` for the
project overview and decisions; the backlog lives in VibeCodes.

## Stack

- **Next.js 16** (App Router, TypeScript) + **Tailwind CSS 4**
- **Supabase** — Postgres, Auth, Storage (Row-Level Security from day one)
- **next-intl** — Portuguese + English
- Hosted on **Vercel** (free Hobby + preview deploys)

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL + anon key
npm run dev                  # http://localhost:3000
```

Health check: `GET /api/health` → `{ "status": "ok" }`.

### Local database (Supabase CLI)

```bash
# install once: https://supabase.com/docs/guides/cli
supabase start              # local Postgres + Studio (Docker)
supabase db reset           # applies supabase/migrations/*.sql
```

`0001_init.sql` sets up the multi-tenant spine: `organisations`,
`memberships(user, org, role)`, helper functions, and deny-by-default RLS. The
full domain schema and role matrix arrive in their own tasks.

## Scripts

| Command                           | Purpose          |
| --------------------------------- | ---------------- |
| `npm run dev`                     | Dev server       |
| `npm run build`                   | Production build |
| `npm run lint`                    | ESLint           |
| `npm run typecheck`               | `tsc --noEmit`   |
| `npm run format` / `format:check` | Prettier         |

## Environments

- **Local** — `next dev` + Supabase CLI.
- **Preview** — automatic Vercel deploy per PR.
- **Production** — Vercel `main`, one Supabase project (EU region).

No separate staging while there's no live data (cost-minimised, $0/mo). A
production-support footing — backups, prod-data isolation, monitoring — is a
dedicated pre-launch task before go-live.

## Conventions

- Every tenant-scoped table carries `organisation_id`; access is enforced by RLS.
- Soft-delete via `deleted_at` (keeps attribution; excluded from RLS reads).
- Secrets never live in the repo — only in `.env.local` (gitignored) and Vercel.
