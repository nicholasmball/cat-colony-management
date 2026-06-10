# Transactional email — arm-it checklist

The app's transactional-email layer (`lib/email/`) is **provider-agnostic and
flag-gated**. It ships **disarmed**: with the flags unset it is a typed no-op —
`send()` returns `{ skipped: true }`, logs a structured `email.skipped` line, and
**never throws**. Nothing about invites, the digest cron, or the build depends on
a real email provider until you arm it here.

What this layer DOES send (when armed):

- **Invite emails** — a branded invitation when an admin invites a volunteer.
- **Daily digest** — one routine-alert summary per recipient per org, in that
  recipient's stored language, from the `email-digest` cron.

What this layer does **NOT** send (owned by **Supabase Auth SMTP**, configured
separately below):

- **Password reset** (forgot-password flow) and any **confirm/recovery** emails.

---

## 1. Create a Resend account + API key

1. Sign up at <https://resend.com> (for the MVP this is **Nick's own account** —
   see "Swapping to SCoT's account" at the end).
2. Create an **API key** (Resend dashboard → API Keys). Copy it — you only see it
   once. It looks like `re_xxxxxxxxxxxxxxxxxxxx`.

## 2. Choose a verified sender (`EMAIL_FROM`)

Two options:

- **Fastest (testing):** use Resend's `onboarding@resend.dev` sender, which can
  only deliver to **your own** Resend-account email. Good for a first live test.
- **Production:** verify a domain in Resend (add the **SPF**, **DKIM** and
  **DMARC** DNS records Resend shows you) and send from e.g.
  `Street Cats of Tavira <no-reply@app.streetcatsoftavira.org>`. Wait for Resend
  to show the domain as **Verified** before relying on it.

`EMAIL_FROM` must be the full `Name <address@domain>` form.

## 3. Set the three env vars in Vercel (Production)

In Vercel → Project → Settings → Environment Variables (Production):

| Variable         | Value                                                                  |
| ---------------- | ---------------------------------------------------------------------- |
| `EMAIL_ENABLED`  | `true` (exact string — the strict allowlist; see `lib/email/flags.ts`) |
| `RESEND_API_KEY` | the key from step 1                                                    |
| `EMAIL_FROM`     | the verified sender from step 2                                        |

The layer arms **only when BOTH** `EMAIL_ENABLED === "true"` **and**
`RESEND_API_KEY` is present (`emailMode` truth table). Then **redeploy** so the
functions pick up the new env (env is read at call time, but a deploy guarantees
the running build sees them).

> 12-Factor: these are **config**, never committed. `.env.example` documents them
> with blank values only.

## 4. Configure Supabase Auth custom SMTP (reset / confirm emails)

The forgot-password and any confirm/recovery emails are sent by **Supabase Auth**,
not this layer. Point Supabase Auth at an SMTP provider so those deliver reliably
(Supabase's built-in email is rate-limited and not for production):

1. Supabase dashboard → **Authentication → Emails → SMTP Settings** → enable
   **Custom SMTP**.
2. Use Resend's SMTP credentials (host `smtp.resend.com`, port `465`, username
   `resend`, password = a Resend API key) **or** any other SMTP provider.
3. Set the sender name/address to match your verified domain.
4. Ensure the **Site URL** and **Redirect URLs** in Supabase Auth include the app
   origin and `…/auth/confirm` so the recovery link lands on
   `/auth/confirm?next=/auth/reset` (the flow used by `app/forgot-password`).

## 5. Schedule the daily-digest pg_cron job (do this ONLY when armed)

The route `POST /api/cron/email-digest` exists and is bearer-guarded, but the
pg_cron job is **deliberately NOT scheduled** until email is armed (so it can't
stamp notifications as dispatched while the layer is a no-op). It reuses the same
`CRON_SECRET` as the alert sweep (already in Vercel + Supabase Vault as
`cron_alert_bearer`). To schedule it (mirrors the alert-engine sweep):

```sql
-- Daily at 07:00 UTC (adjust to taste). pg_net + pg_cron must already be
-- installed (they are, for the alert sweep). Reuses the Vault-stored bearer.
select cron.schedule(
  'email-digest-daily',
  '0 7 * * *',
  $$
  select net.http_post(
    url     := 'https://cat-colony-management.vercel.app/api/cron/email-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization',
        'Bearer ' || (select decrypted_secret
                        from vault.decrypted_secrets
                        where name = 'cron_alert_bearer')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

To pause: `select cron.unschedule('email-digest-daily');` (or set the job
`active = false`). To verify: check `cron.job_run_details` and
`net._http_response` for a `200 {sent,recipients}`.

## 6. Live send test

1. With the three env vars set + a redeploy done, **invite a volunteer** to your
   own email address from the Members page. You should receive the branded invite
   (and the pending list still offers the copy-link fallback regardless).
2. (Digest) With at least one undispatched routine notification for your account,
   manually fire the route:
   ```bash
   curl -X POST https://cat-colony-management.vercel.app/api/cron/email-digest \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
   Expect `{ "sent": 1, "recipients": 1 }` and a digest email; the covered rows
   get `dispatched_at` stamped so the next run won't re-send them.
3. (Reset) Use **Forgot password?** on the login page and confirm the Supabase
   Auth SMTP email arrives and the `/auth/reset` page lets you set a new password.

---

## Swapping to SCoT's account later

Moving from Nick's Resend account to SCoT's is **only an env-var change** — no
code changes:

1. Create the API key + verify the domain in **SCoT's** Resend account.
2. Update `RESEND_API_KEY` (and `EMAIL_FROM` if the sender domain changes) in
   Vercel, then redeploy.
3. If reset/confirm SMTP also moves, update Supabase Auth's custom SMTP creds.

Because everything provider-specific is isolated in `lib/email/adapter-resend.ts`
behind `lib/email/index.ts`'s signature, switching providers entirely (away from
Resend) is a one-file change plus a dependency swap.

## Disarming / kill

Set `EMAIL_ENABLED` to anything but `true` (or remove `RESEND_API_KEY`) and
redeploy → the layer instantly returns to the no-op path; invites fall back to
the Supabase invite + copy-link, and the digest cron (if scheduled) sends nothing
and stamps nothing. Optionally unschedule the pg_cron job (step 5).
