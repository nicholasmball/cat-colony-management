import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

// App Router without locale-prefixed routing for now: the active locale comes
// from a `locale` cookie (default Portuguese). Full locale routing / switching
// is delivered in the dedicated "Internationalisation — Portuguese + English"
// task. This file just gives every request its messages.
const SUPPORTED = ["pt", "en"] as const;
const DEFAULT_LOCALE = "pt";

export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get("locale")?.value;
  const locale = SUPPORTED.includes(cookieLocale as (typeof SUPPORTED)[number])
    ? (cookieLocale as string)
    : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
