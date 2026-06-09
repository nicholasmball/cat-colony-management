// Pure locale-resolution helpers — no Next/cookie imports so the precedence
// rules are trivially unit-testable. Used by i18n/request.ts and the switcher.

export const SUPPORTED_LOCALES = ["pt", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

// The configured default falls back to "pt" if the env var is missing or set to
// something we don't support. NEXT_PUBLIC_ so it's inlined at build time and can
// be referenced on the client too.
export function defaultLocale(): Locale {
  const env = process.env.NEXT_PUBLIC_DEFAULT_LOCALE;
  return isLocale(env) ? env : "pt";
}

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

// Parse an Accept-Language header and return a supported locale if one is
// clearly preferred, else null. We only ever switch a no-cookie visitor to EN
// when English clearly outranks Portuguese; otherwise we keep the PT default
// (SCoT's primary audience). Quality values (q=…) are honoured.
export function localeFromAcceptLanguage(
  header: string | null | undefined,
): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.split("=")[1]) : 1;
      return {
        base: tag.trim().toLowerCase().split("-")[0],
        q: Number.isNaN(q) ? 0 : q,
      };
    })
    .filter((x) => x.base.length > 0)
    .sort((a, b) => b.q - a.q);

  for (const { base } of ranked) {
    if (base === "en") return "en";
    if (base === "pt") return "pt";
  }
  return null;
}

// Resolve the active locale with the approved precedence:
//   valid cookie > Accept-Language > NEXT_PUBLIC_DEFAULT_LOCALE.
// An invalid cookie is ignored (falls through), never throws.
export function pickLocale({
  cookieLocale,
  acceptLanguage,
}: {
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (isLocale(cookieLocale)) return cookieLocale;
  return localeFromAcceptLanguage(acceptLanguage) ?? defaultLocale();
}
