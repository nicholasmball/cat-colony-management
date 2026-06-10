// Shared HTML shell + escaping for email templates. Deliberately PLAIN +
// accessible: a single centred column, system fonts, real heading + paragraph
// structure, a high-contrast button-styled link, and a lang attribute so screen
// readers announce the right language. No external CSS/images (many clients
// strip them); inline styles only. Every template also returns a text part.

import { type Locale } from "../../../i18n/locale.ts";

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

// Wrap a heading + pre-built body HTML in the shared shell. `bodyHtml` is
// trusted, already-escaped markup assembled by the caller.
export function wrapHtml({
  locale,
  title,
  bodyHtml,
}: {
  locale: Locale;
  title: string;
  bodyHtml: string;
}): string {
  return `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(
    title,
  )}</title></head>
<body style="margin:0;padding:0;background:#f5f5f4;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1917;line-height:1.5;">
${bodyHtml}
</div>
</body>
</html>`;
}

// A button-styled link. Uses a real <a> (not a JS button) so it works in every
// client and is keyboard/AT-reachable.
export function ctaButton(label: string, url: string): string {
  return `<p style="margin:24px 0;"><a href="${escapeHtml(
    url,
  )}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:9999px;">${escapeHtml(
    label,
  )}</a></p>`;
}
