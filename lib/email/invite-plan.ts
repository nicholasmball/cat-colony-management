// Pure decision for the invite action's two paths — extracted so the "branded
// send vs. Supabase copy-link fallback" choice is node:test-able without the
// server clients, next/headers, or a live Resend. The action (app/app/members/
// actions.ts) calls this, then performs the chosen I/O.
//
// Branded send requires BOTH the layer to be armed ("send") AND an acceptUrl to
// link to (we can only brand an invite that has a copy-link). Anything else →
// the unchanged fallback (Supabase inviteUserByEmail best-effort + copy-link),
// so the invite flow never breaks or depends on Resend.

import { type EmailMode } from "./flags.ts";

export type InvitePath = "branded" | "fallback";

export function inviteEmailPath(
  mode: EmailMode,
  acceptUrl: string | undefined,
): InvitePath {
  return mode === "send" && !!acceptUrl ? "branded" : "fallback";
}
