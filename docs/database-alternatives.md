# Database / backend alternatives — a "just in case" fallback plan

_Verified against current (mid-2026) free-tier terms. Goal: know our escape routes before photos push Supabase off its free tier._

## TL;DR

1. **The thing that will cost money isn't the database — it's photo storage.** Our text data is tiny and will sit inside Supabase's free 500 MB database for a very long time. What pushes us to Supabase Pro (£25/mo) is the **1 GB file-storage limit** (photos) and the **1-week inactivity pause**.
2. **We haven't built photo storage yet** (it's still a backlog item), so we can dodge the problem _before it happens_: when we build photos, point them at **Cloudflare R2** (10 GB free, **zero** download fees) instead of Supabase Storage. Add a tiny keep-alive ping to avoid the pause, and our own nightly backup to R2. That likely keeps us on **Supabase Free indefinitely at our scale.**
3. **If we ever do need to leave Supabase**, the cleanest target is **Neon** (it's the same Postgres, so our schema, security rules and functions move over with little change) — pair it with R2 for files. Auth is the only fiddly part.
4. **Break-glass identical option:** self-host Supabase on a ~£5/mo server — zero code changes, just more admin.

---

## Why switching isn't a casual decision

The app is built fairly deeply on Supabase: Postgres **row-level security** (our multi-tenant safety net), **database functions/triggers**, and **Supabase Auth** (login, invites). Those are real value, not boilerplate — so "swap the database" ranges from _easy_ (a Postgres-compatible host) to _a rewrite_ (a totally different kind of database). The table below rates that honestly.

## The options

| Option                                      | Free tier (now)                                                                              | Fit for us                                                                | Migration effort                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Stay on Supabase Free + photos on R2**    | DB 500 MB, auth 50k users; **R2:** 10 GB files, zero egress                                  | **Best.** Removes the main cost trigger; nothing else changes             | **Low** — only affects the (not-yet-built) photo feature         |
| **Neon** (Postgres)                         | 0.5 GB/branch (5 GB total), scale-to-zero, **never pauses/expires**, no auth or file storage | Strong DB-only fallback — keeps our SQL, RLS, functions                   | **Medium** — move auth off Supabase; add R2 for files            |
| **Self-hosted Supabase** (cheap VPS ~£5/mo) | "Free" software, you pay the server                                                          | Identical to today — **zero code change**                                 | **Low code / higher ops** — you run the server, updates, backups |
| **Xata** (Postgres)                         | 15 GB DB, no pausing, no cold starts — **but files removed from free tier (2025)**           | OK for data, no good for our photos                                       | **Medium** + still need R2 for files                             |
| **Nhost** (Postgres + Hasura)               | DB 500 MB, auth 10k, storage 1 GB                                                            | Closest "full Supabase-like" but **GraphQL-first** — different data layer | **High** — rework data access to GraphQL                         |
| **Appwrite** (own DB)                       | 2 projects, **pauses after 7 days**; Pro $25/project                                         | Full backend, but **not Postgres** — lose our RLS/SQL                     | **Very high** — effectively a rewrite                            |
| **Firebase / Firestore**                    | Generous free; auth + storage included                                                       | **Not** a relational DB — wrong shape for colonies→cats→events            | **Very high** — full rewrite                                     |
| **Turso / PocketBase** (SQLite)             | Very generous free / single-file self-host                                                   | SQLite has no RLS or our Postgres functions                               | **High** — re-implement security in app code                     |

## Recommendation

- **Now:** do nothing — we're free and fine.
- **When we build the photo feature (backlog item):** use **Cloudflare R2** from day one, not Supabase Storage. This is the single highest-value move — it's free for 10 GB _and_ has no download charges, and it stops us ever hitting the Supabase storage limit. It also means photos are already portable if we move databases later.
- **Keep-alive + backups:** a tiny scheduled ping keeps the free Supabase project from pausing; a nightly `pg_dump` to R2 gives us our own backups (the other reason people pay for Pro).
- **Documented escape hatch:** if Supabase ever raises prices or limits, **Neon + R2** is the pre-planned move (same Postgres, so low-risk), with **self-hosted Supabase** as the zero-rewrite emergency option.

**Net:** we have a credible path to stay at roughly **£0–5/month well beyond launch**, and two clear fallbacks if Supabase ever stops being the cheap option. No action needed today — this is the insurance policy.

---

### Sources

- Neon free plan — https://neon.com/pricing · https://neon.com/docs/introduction/plans
- Cloudflare R2 pricing (10 GB free, zero egress) — https://developers.cloudflare.com/r2/pricing/
- Supabase pricing & free-tier pause — https://supabase.com/pricing · https://supabase.com/docs/guides/platform/billing-on-supabase
- Xata free-tier changes (files removed) — https://xata.io/blog/changes-free-tier
- Nhost / Appwrite / Supabase-alternatives overview — https://uibakery.io/blog/supabase-alternatives
