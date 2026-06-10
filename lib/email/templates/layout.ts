// Shared HTML shell + escaping for email templates. Implements the canonical
// SCoT email chrome (see docs/supabase-reset-email.html, now live on all
// Supabase auth emails): a table-based, email-client-safe layout with inline
// styles only — a cream backdrop, a white rounded card, the SCoT logo + an
// uppercase brand kicker in the header, an indigo primary button, and a muted
// footer tagline. No external CSS; logo is the one absolute image the design
// allows. Every template also returns a plain-text part for accessibility +
// deliverability, and a lang attribute so screen readers announce the language.

import { type Locale } from "../../../i18n/locale.ts";

// The SCoT logo, served from the production app. Matches the canonical design.
const LOGO_URL = "https://cat-colony-management.vercel.app/icon-192.png";

// Escape the five HTML-significant chars so interpolated org names / roles can
// never inject markup into the email body.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type EmailContent = { subject: string; html: string; text: string };

// Wrap pre-built body HTML in the shared branded card. `bodyHtml` is trusted,
// already-escaped markup assembled by the caller; `kicker` + `footer` are the
// localised brand strings, escaped here. The card mirrors the canonical chrome:
// cream backdrop → white rounded card → logo + uppercase kicker → body → footer.
export function wrapHtml({
  locale,
  title,
  kicker,
  footer,
  bodyHtml,
}: {
  locale: Locale;
  title: string;
  kicker: string;
  footer: string;
  bodyHtml: string;
}): string {
  return `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(
    title,
  )}</title></head>
<body style="margin:0;padding:0;background:#f7f4f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4f2;margin:0;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e6e0d8;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr>
          <td align="center" style="padding:32px 32px 8px;">
            <img src="${LOGO_URL}" width="64" height="64" alt="${escapeHtml(
              kicker,
            )}" style="display:block;border-radius:14px;" />
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:4px 32px 0;">
            <div style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#8a7f73;font-weight:700;">${escapeHtml(
              kicker,
            )}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 8px;color:#3a3a3a;line-height:1.6;">
${bodyHtml}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:8px 32px 28px;border-top:1px solid #efeae2;">
            <div style="font-size:12px;color:#b3a89c;padding-top:16px;">${escapeHtml(
              footer,
            )}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// The primary call-to-action: a real <a> (not a JS button) so it works in every
// client and is keyboard/AT-reachable, styled as the canonical indigo button.
export function ctaButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td align="center"><a href="${escapeHtml(
    url,
  )}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:13px 28px;border-radius:10px;">${escapeHtml(
    label,
  )}</a></td></tr></table>`;
}
