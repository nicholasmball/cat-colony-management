import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { pickLocale, type Locale } from "./locale";

import en from "../messages/en.json";
import pt from "../messages/pt.json";

const messagesByLocale: Record<Locale, Record<string, unknown>> = { en, pt };

// App Router without locale-prefixed routing: the active locale is resolved per
// request from (in precedence order) a valid `locale` cookie → the request's
// Accept-Language header → NEXT_PUBLIC_DEFAULT_LOCALE (pt). See pickLocale.
//
// Missing-key fallback: English is the source language, so any key absent from
// the active locale falls back to the EN value (never a raw `a.b.c` path or a
// blank). In development a missing key is surfaced via onError.
export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale = pickLocale({
    cookieLocale: cookieStore.get("locale")?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });

  const messages = messagesByLocale[locale];

  return {
    locale,
    messages,
    // English is the fallback message catalogue for keys missing in `messages`.
    onError(error) {
      if (
        process.env.NODE_ENV === "development" &&
        error.code === "MISSING_MESSAGE"
      ) {
        console.warn(`[i18n] ${error.message}`);
        return;
      }
      // Suppress the noisy missing-message error in prod — getMessageFallback
      // already provides the EN value (or a readable last-segment fallback).
      if (error.code === "MISSING_MESSAGE") return;
      throw error;
    },
    getMessageFallback({ key }) {
      // key is the full dotted path. Resolve it against the EN catalogue.
      const fromEn = resolveKey(en, key);
      if (typeof fromEn === "string") return fromEn;
      // Last resort: the final segment, humanised — never a raw `a.b.c` path.
      return key.split(".").pop() ?? key;
    },
  };
});

// Walk a dotted key path ("a.b.c") through a nested messages object.
function resolveKey(obj: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === "object" && segment in acc) {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, obj);
}
