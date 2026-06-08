// Shared "does this email have a pending invite?" lookup, used by both the
// /accept surface (email-link path) and /app first-run (so an invitee never
// lands on create-org). SERVER-ONLY: it reads invitations via the service
// client, which bypasses RLS, so it must never run in the browser.

import { createServiceClient } from "./supabase/service.ts";

export type PendingInvite = {
  email: string;
  role: string;
  token: string;
  accepted_at: string | null;
  organisations: { name: string } | { name: string }[] | null;
};

/**
 * The earliest still-open invite for `email`, or null. Case-insensitive match
 * (invites are stored lowercased but auth emails aren't guaranteed to be).
 */
export async function getPendingInvite(
  email: string,
): Promise<PendingInvite | null> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("invitations")
    .select("email, role, token, accepted_at, organisations(name)")
    .ilike("email", email)
    .is("accepted_at", null)
    .limit(1)
    .maybeSingle();
  return (data as PendingInvite) ?? null;
}

/**
 * Pure first-run routing decision. Given whether the signed-in user already
 * belongs to an org and whether a pending invite exists for their email,
 * decide where /app should send them on first run:
 *   - "app"        → has a membership; stay on the app (no redirect needed)
 *   - "accept"     → no membership but a pending invite → resolve it
 *   - "create-org" → no membership and no invite → onboarding (create org)
 */
export function firstRunDestination({
  hasMembership,
  hasPendingInvite,
}: {
  hasMembership: boolean;
  hasPendingInvite: boolean;
}): "app" | "accept" | "create-org" {
  if (hasMembership) return "app";
  if (hasPendingInvite) return "accept";
  return "create-org";
}
