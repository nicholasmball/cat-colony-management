// Request-FREE i18n for email templates. The next-intl request pipeline
// (i18n/request.ts) resolves the locale from cookies/headers — but the daily
// digest renders from a cron POST with NO request context, and the invite email
// renders for an invitee who has no session at all. So templates select their
// catalogue by an EXPLICIT locale arg instead, importing the same message JSON
// the app uses (single source of truth — no duplicated copy).
//
// Mirrors i18n/request.ts's EN-fallback contract: a key missing in the active
// locale falls back to the English value (English is the source language), so a
// PT gap renders sensible EN rather than a raw "a.b.c" path.

import { type Locale } from "../../i18n/locale.ts";
import en from "../../messages/en.json" with { type: "json" };
import pt from "../../messages/pt.json" with { type: "json" };

const catalogues: Record<Locale, Record<string, unknown>> = { en, pt };

// Walk a dotted key path ("email.invite.subject") through a nested object.
function resolvePath(obj: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === "object" && segment in acc) {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, obj);
}

// Substitute {name}-style ICU placeholders. Templates use only simple value
// interpolation (no plurals/select), so a tiny replacer is enough and keeps the
// templates dependency-free + synchronous for cron use.
function interpolate(
  template: string,
  params: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

// A bound translator for one locale + namespace: t("subject", { orgName }).
// Falls back to the EN catalogue for a missing key, then to the key's last
// segment — never a raw path or a blank, matching i18n/request.ts.
export function emailTranslator(locale: Locale, namespace: string) {
  return (
    key: string,
    params: Record<string, string | number> = {},
  ): string => {
    const full = `${namespace}.${key}`;
    const fromLocale = resolvePath(catalogues[locale], full);
    const value =
      typeof fromLocale === "string"
        ? fromLocale
        : (() => {
            const fromEn = resolvePath(en, full);
            return typeof fromEn === "string"
              ? fromEn
              : (key.split(".").pop() ?? key);
          })();
    return interpolate(value, params);
  };
}
