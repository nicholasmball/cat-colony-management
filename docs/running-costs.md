# SCoT Colony App — rough monthly running costs

_Estimate for the operational app only. The Wix public site is separate and unaffected._

Bottom line up front:

| Stage | Realistic monthly cost |
|---|---|
| **MVP / launch** (free tiers, light SMS) | **~£0–5 / mo** |
| **Once photos + real usage grow** (Supabase Pro) | **~£25–35 / mo** |
| **If we outgrow Vercel's free tier too** | **+£16–18 / mo** |

So: **near-zero to start, ~£30/month once it's genuinely in daily use with photos.** The only cost that grows with usage is SMS, and that's small.

---

## Line by line

### Hosting — Vercel
- **Free (Hobby): £0/mo.** Fine for the MVP. Covers the app, previews, HTTPS.
- Moves to **Pro (~£16–18/mo)** only if we need more bandwidth, team seats, or if Vercel deems it "commercial." A registered charity MVP can stay on free for a good while.

### Database, auth & photo storage — Supabase
- **Free: £0/mo** — 500 MB database, 1 GB file storage, 50,000 monthly active users, daily-ish limits. Enough to launch and test.
- **Pro: ~£25/mo** — the realistic steady-state cost. We'll want this once **photos** land (storage adds up fast) and for **daily backups** + no auto-pausing of an idle project. This is the single biggest line once live.

### Domain (e.g. `app.streetcatsoftavira.org`)
- **~£1–2/mo** (a `.org` is ~£12–18/year). One-off-ish; may already be covered by the existing domain.

### SMS for urgent alerts — Twilio (the only usage-based cost)
- **~£0.06–0.07 per SMS** to Portuguese mobiles.
- Only **urgent** incidents trigger SMS (poisoning, injured cat, dog danger, threat) — not routine activity.
- At, say, **20–50 urgent texts/month → ~£1.50–3.50/mo.**
- Sender: Portugal supports **alphanumeric sender IDs** (texts show as "SCoT"), which avoids renting a number. A dedicated number, if wanted, is ~£1/mo.
- **Cost control:** urgent-only by design, per-org monthly cap, and a fallback to free web-push so SMS is the exception, not the default.

### Web push notifications
- **£0.** Standard browser push (VAPID). Works on installed PWA incl. iPhone.

### Transactional email (invites, password resets)
- **£0** on Supabase's built-in auth emails, or a free tier (e.g. Resend ~3,000 emails/mo) if we want nicer templates.

### Error monitoring (optional, recommended)
- **£0** on Sentry's free developer tier for an app this size.

---

## Assumptions & notes
- Scale assumed: one charity, a handful of colonies, a small number of volunteers, modest photo use — i.e. SCoT's actual MVP, not a national rollout.
- Currency: GBP, rough conversions; providers bill in USD/EUR so totals wobble a few percent with exchange rates.
- **No per-seat licence costs** in the app itself — volunteers don't pay, and we store minimal personal data by design.
- Biggest swing factors, in order: (1) Supabase Free→Pro once photos/usage grow, (2) Vercel Free→Pro if/when needed, (3) SMS volume.
- If budget is tight at launch: stay entirely on free tiers (£0–5/mo) and only move Supabase to Pro when storage or backup needs force it.
