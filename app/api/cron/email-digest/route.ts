import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { selectDigests, type DigestRow } from "@/lib/email/digest";
import { notificationKeys } from "@/lib/notifications";
import { emailTranslator } from "@/lib/email/i18n";
import { userEmailAndLocale } from "@/lib/user-locale";
import { send } from "@/lib/email";
import { cronAuthorized } from "@/lib/cron-auth";

// ── Daily-digest cron — the EMAIL half of the routine-alert pipeline ──────────
// The alert engine (and its sweep at /api/cron/alerts) only RECORDS notifications
// with a channel intent; nothing is sent. This route batches the undispatched,
// email-channel (routine) notifications into one digest PER recipient PER org,
// renders it in that recipient's stored locale (lib/user-locale; fallback PT),
// sends via the flag-gated lib/email layer, and stamps dispatched_at on the rows
// a SUCCESSFUL (non-skipped) send covered — so a skipped (flag-off) or failed
// send simply leaves the rows for the next run.
//
// Mirrors /api/cron/alerts: Bearer CRON_SECRET checked FIRST (missing/empty
// rejects), service client, set-based reads — no per-recipient query loop for
// the read. It is meant to be hit daily by Supabase pg_cron + pg_net. The
// pg_cron job is deliberately NOT scheduled yet (see docs/email-setup.md);
// the route exists and is guarded until the email layer is armed.
//
// Flag-off safety: lib/email.send no-ops (skipped:true) when EMAIL_ENABLED /
// RESEND_API_KEY aren't set, so an unscheduled-but-hit route is harmless and
// never stamps anything as dispatched.

export const dynamic = "force-dynamic";

// Backstop cap — one bounded scan, never an unbounded fan-out.
const UNDISPATCHED_SCAN_CAP = 50000;

type OrgRow = { id: string; name: string };

async function siteUrl(req: Request): Promise<string> {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export async function POST(req: Request) {
  // Auth FIRST. A missing/empty CRON_SECRET must reject (no empty-secret bypass).
  if (
    !cronAuthorized(process.env.CRON_SECRET, req.headers.get("authorization"))
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  // One set-based read: undispatched routine (email-channel) notifications. The
  // channel filter is re-applied purely in selectDigests; the overlaps() narrows
  // the scan up front so urgent push/SMS-only rows aren't pulled.
  const { data: notifData } = await svc
    .from("notifications")
    .select(
      "id, recipient_id, organisation_id, type, message_params, channels, dispatched_at",
    )
    .is("dispatched_at", null)
    .overlaps("channels", ["email"])
    .order("created_at", { ascending: false })
    .limit(UNDISPATCHED_SCAN_CAP);

  const rows = (notifData ?? []) as DigestRow[];
  const digests = selectDigests(rows);
  if (digests.size === 0) {
    return NextResponse.json({ sent: 0, recipients: 0 });
  }

  // Org names for the digest heading/subject — one bounded read for the orgs in
  // play (not all orgs).
  const orgIds = [
    ...new Set([...digests.values()].map((d) => d.organisationId)),
  ];
  const { data: orgData } = await svc
    .from("organisations")
    .select("id, name")
    .in("id", orgIds);
  const orgNameById = new Map(
    ((orgData ?? []) as OrgRow[]).map((o) => [o.id, o.name]),
  );

  const appBase = await siteUrl(req);
  let sent = 0;

  for (const payload of digests.values()) {
    const { email, locale } = await userEmailAndLocale(
      svc,
      payload.recipientId,
    );
    // No address (departed user / no email) → skip, leave rows undispatched.
    if (!email) continue;

    // Resolve each notification's title in the recipient's locale using the
    // same catalog keys the in-app centre uses (lib/notifications.notificationKeys
    // → alerts.<type>.title), via the request-free email translator.
    const t = emailTranslator(locale, "alerts");
    const itemTitles = payload.items.map((item) => {
      const { titleKey } = notificationKeys(item.type, item.message_params);
      // titleKey is the full "alerts.<...>.title" path; strip the namespace
      // prefix the bound translator already carries.
      const key = titleKey.replace(/^alerts\./, "");
      return t(key, item.message_params as Record<string, string | number>);
    });

    const orgName = orgNameById.get(payload.organisationId) ?? "";
    const result = await send({
      to: email,
      locale,
      template: "daily-digest",
      params: {
        appUrl: `${appBase}/app/notifications`,
        orgName,
        itemTitles,
      },
    });

    // Only a real, successful send stamps the rows as dispatched. A skipped
    // (flag-off) or failed send leaves them undispatched for the next run.
    if (result.skipped === false && result.ok === true) {
      sent += 1;
      await svc
        .from("notifications")
        .update({ dispatched_at: new Date().toISOString() })
        .in("id", payload.rowIds);
    }
  }

  return NextResponse.json({ sent, recipients: digests.size });
}
