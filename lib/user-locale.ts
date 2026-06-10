// Per-user preferred language (pt/en) resolution. SERVER-ONLY.
//
// MECHANISM (decided): the locale is stored on the Supabase AUTH USER METADATA
// (auth.users.user_metadata.locale), NOT a DB column. Why:
//   * There is no natural per-USER table to hang it on — memberships are
//     per-ORG (a volunteer can be in several orgs, but their UI language is one
//     personal preference, not a per-membership one), and CLAUDE.md's GDPR-
//     minimal rule ("store only a username/ID, not tracking the volunteers")
//     argues against adding a new personal-data table.
//   * The email who-resolution already reads users via the service client's
//     admin API (getUserById), so reading metadata there is zero extra schema.
//   * No migration to write/apply → nothing to retrofit.
// The language switcher persists it (auth.updateUser({data:{locale}})); the
// digest cron reads it per recipient here. Fallback is PT (SCoT's primary
// audience, matching defaultLocale()).

import type { SupabaseClient } from "@supabase/supabase-js";
import { isLocale, type Locale } from "../i18n/locale.ts";

// Pure: pluck a valid locale out of an auth user's metadata, else null. Kept
// separate from the I/O so the "what counts as a stored locale" rule is
// unit-tested without a live Supabase.
export function localeFromUserMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Locale | null {
  const value = metadata?.locale;
  return isLocale(value) ? value : null;
}

// Resolve one user's stored locale via the service (admin) client, falling back
// to PT when unset/invalid/unknown. Used by the digest cron per recipient.
export async function userLocale(
  svc: SupabaseClient,
  userId: string,
): Promise<Locale> {
  return (await userEmailAndLocale(svc, userId)).locale;
}

// Resolve a recipient's email + stored locale in one admin lookup — the digest
// needs both (the address to send to, the language to render in). Email is null
// when the user is gone/has none; locale falls back to PT.
export async function userEmailAndLocale(
  svc: SupabaseClient,
  userId: string,
): Promise<{ email: string | null; locale: Locale }> {
  const { data } = await svc.auth.admin.getUserById(userId);
  return {
    email: data?.user?.email ?? null,
    locale: localeFromUserMetadata(data?.user?.user_metadata) ?? "pt",
  };
}
