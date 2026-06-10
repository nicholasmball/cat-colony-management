// Branded invite email — pure render(locale, params) → {subject, html, text}.
// Request-free (selects the catalogue by explicit locale), so it works for an
// invitee who has no session. Sent ONLY when the email layer is armed; when off,
// the members action keeps today's Supabase-invite + copy-link fallback.

import { type Locale } from "../../../i18n/locale.ts";
import { emailTranslator } from "../i18n.ts";
import {
  ctaButton,
  escapeHtml,
  wrapHtml,
  type EmailContent,
} from "./layout.ts";

export type InviteParams = {
  acceptUrl: string;
  orgName: string;
  role: string;
};

export function renderInvite(
  locale: Locale,
  params: InviteParams,
): EmailContent {
  const t = emailTranslator(locale, "email.invite");
  const subject = t("subject", { orgName: params.orgName });
  const heading = t("heading", { orgName: params.orgName });
  const body = t("body", { orgName: params.orgName, role: params.role });
  const cta = t("cta");

  const html = wrapHtml({
    locale,
    title: subject,
    bodyHtml: `<h1 style="font-size:22px;margin:0 0 12px;">${escapeHtml(
      heading,
    )}</h1>
<p style="margin:0 0 8px;">${escapeHtml(body)}</p>
${ctaButton(cta, params.acceptUrl)}
<p style="margin:8px 0;color:#57534e;font-size:13px;">${escapeHtml(
      params.acceptUrl,
    )}</p>`,
  });

  const text = `${heading}\n\n${body}\n\n${cta}: ${params.acceptUrl}\n`;

  return { subject, html, text };
}
