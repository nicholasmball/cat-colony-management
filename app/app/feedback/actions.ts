"use server";

import { cookies, headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { isKeyInOrg } from "@/lib/photo-key";
import { appVersion } from "@/lib/app-version";
import { isFeedbackKind, type FeedbackKind } from "@/lib/feedback";

// Result for the inline form. Mirrors setCatPhoto's { error } / success shape —
// the client renders the success panel on ok, an inline error otherwise.
export type FeedbackResult = { ok: true } | { error: string };

// Submit one piece of UAT feedback. THIS IS THE TRUST BOUNDARY: the only fields
// taken from the client are the kind, the free-text message, the page_url and an
// optional screenshot_key. Everything attributing the row — organisation_id,
// reporter_role and reporter_id — is derived server-side from the authenticated
// session + active org, NEVER from the client payload. (RLS enforces the same in
// the DB as defence in depth: insert is allowed only when reporter_id = auth.uid()
// and the caller is a member of organisation_id.)
export async function submitFeedback(input: {
  kind: string;
  message: string;
  pageUrl?: string | null;
  screenshotKey?: string | null;
}): Promise<FeedbackResult> {
  const t = await getTranslations("feedback");

  const org = await getActiveOrg();
  if (!org) return { error: t("errorSubmit") };

  // kind: reject anything outside the lookup — no row is written.
  if (!isFeedbackKind(input.kind)) return { error: t("errorSubmit") };
  const kind: FeedbackKind = input.kind;

  // message: required. Trim and reject empty — no row written on empty.
  const message = (input.message ?? "").trim();
  if (!message) return { error: t("errorEmpty") };

  // screenshot_key: optional. If present, it must be a string minted under THIS
  // org's feedback prefix — a tampered key can't point at another org's bucket.
  let screenshotKey: string | null = null;
  if (input.screenshotKey) {
    const key = String(input.screenshotKey);
    if (
      !isKeyInOrg(key, org.organisation_id) ||
      !key.startsWith(`org/${org.organisation_id}/feedback/`)
    ) {
      return { error: t("errorSubmit") };
    }
    screenshotKey = key;
  }

  // page_url is advisory context — kept as a bounded string (honest, not trusted).
  const pageUrl = input.pageUrl ? String(input.pageUrl).slice(0, 2000) : null;

  // Server-derived context: locale (next-intl cookie), user_agent (header),
  // app_version (build env). reporter_id comes from the authenticated session.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("errorSubmit") };

  const locale = (await cookies()).get("locale")?.value ?? null;
  const userAgent = (await headers()).get("user-agent") ?? null;

  // Insert via the RLS client: the DB re-checks reporter_id = auth.uid() AND
  // membership of organisation_id. status / vibecodes_task_id are left to their
  // defaults ('new' / null) — only the service-role bot moves them.
  const { error } = await supabase.from("feedback").insert({
    organisation_id: org.organisation_id,
    reporter_id: user.id,
    reporter_role: org.role,
    kind,
    message,
    page_url: pageUrl,
    locale,
    app_version: appVersion(),
    user_agent: userAgent,
    screenshot_key: screenshotKey,
  });
  if (error) return { error: t("errorSubmit") };

  return { ok: true };
}
