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
  const brand = emailTranslator(locale, "email");
  // Reuse the in-app role labels (members.role.*) so the body shows a
  // localized, capitalized label ("Caretaker" / "Cuidador") rather than the
  // raw lowercase enum the members action passes in.
  const roleLabel = emailTranslator(locale, "members.role")(params.role);
  const subject = t("subject", { orgName: params.orgName });
  const heading = t("heading", { orgName: params.orgName });
  const body = t("body", { orgName: params.orgName, role: roleLabel });
  const cta = t("cta");
  const kicker = brand("kicker");
  const footer = brand("tagline");

  const html = wrapHtml({
    locale,
    title: subject,
    kicker,
    footer,
    bodyHtml: `<h1 style="margin:0 0 12px;font-size:21px;line-height:1.3;color:#2a2a2a;">${escapeHtml(
      heading,
    )}</h1>
<p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#3a3a3a;">${escapeHtml(
      body,
    )}</p>
${ctaButton(cta, params.acceptUrl)}
<p style="margin:8px 0 0;font-size:12px;line-height:1.5;word-break:break-all;color:#8a7f73;"><a href="${escapeHtml(
      params.acceptUrl,
    )}" style="color:#4f46e5;">${escapeHtml(params.acceptUrl)}</a></p>`,
  });

  const text = `${heading}\n\n${body}\n\n${cta}: ${params.acceptUrl}\n`;

  return { subject, html, text };
}
