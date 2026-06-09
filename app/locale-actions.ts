"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isLocale } from "@/i18n/locale";

// Persisted for a year. httpOnly is fine: the locale is read server-side in
// i18n/request.ts; the client never needs to read the cookie (the switcher's
// current selection comes from the active `locale` prop, not document.cookie).
const LOCALE_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365, // a year
};

// Set the active locale and re-render the whole tree in the new language.
// Invalid values are ignored (no-op) so a tampered submit can't break rendering.
// Re-selecting the current locale still revalidates harmlessly; the switcher
// guards the idempotent case client-side so this isn't normally hit for a no-op.
export async function setLocale(formData: FormData) {
  const next = String(formData.get("locale") ?? "");
  if (!isLocale(next)) return;
  (await cookies()).set("locale", next, LOCALE_COOKIE_OPTS);
  revalidatePath("/", "layout");
}
