// Daily-digest email — pure render(locale, params) → {subject, html, text}.
// Request-free (selects the catalogue by explicit locale) because it renders
// from the cron POST with no request context, in EACH recipient's stored locale.
//
// Content design: a digest is a nudge, not the full record. It summarises how
// many routine alerts are waiting and lists their (already-localised) titles,
// then links to the in-app notification centre where the full, live detail
// lives. Item titles are rendered by the caller via lib/notifications +
// lib/email/i18n (so the digest template stays a dumb layout) and passed in.

import { type Locale } from "../../../i18n/locale.ts";
import { emailTranslator } from "../i18n.ts";
import {
  ctaButton,
  escapeHtml,
  wrapHtml,
  type EmailContent,
} from "./layout.ts";

export type DigestParams = {
  appUrl: string;
  orgName: string;
  // Pre-localised, one per included notification (newest first). The caller
  // resolves these from each row's titleKey + params in the recipient's locale.
  itemTitles: string[];
};

export function renderDailyDigest(
  locale: Locale,
  params: DigestParams,
): EmailContent {
  const t = emailTranslator(locale, "email.digest");
  const count = params.itemTitles.length;
  const subject = t("subject", { orgName: params.orgName, count });
  const heading = t("heading", { orgName: params.orgName });
  const summary = t("summary", { count });
  const cta = t("cta");
  const footer = t("footer");

  const items = params.itemTitles
    .map((title) => `<li style="margin:6px 0;">${escapeHtml(title)}</li>`)
    .join("\n");

  const html = wrapHtml({
    locale,
    title: subject,
    bodyHtml: `<h1 style="font-size:22px;margin:0 0 12px;">${escapeHtml(
      heading,
    )}</h1>
<p style="margin:0 0 8px;">${escapeHtml(summary)}</p>
<ul style="margin:0 0 8px;padding-left:20px;">
${items}
</ul>
${ctaButton(cta, params.appUrl)}
<p style="margin:16px 0 0;color:#57534e;font-size:13px;">${escapeHtml(
      footer,
    )}</p>`,
  });

  const text = `${heading}\n\n${summary}\n\n${params.itemTitles
    .map((title) => `- ${title}`)
    .join("\n")}\n\n${cta}: ${params.appUrl}\n\n${footer}\n`;

  return { subject, html, text };
}
