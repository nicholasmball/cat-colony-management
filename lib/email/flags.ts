// Pure decision logic for the transactional-email layer — mirrors the strict
// flag pattern from lib/offline/sw-flags.ts. NO I/O, NO SDK import: the only
// branching lives here so it is node:test-able, and the rest of the layer is a
// thin caller.
//
// The email layer is FLAG-GATED + ARMED-READY: it is built to really send when
// armed, but is a clean typed no-op until then. It arms ONLY when BOTH are true:
//   * EMAIL_ENABLED is the exact string "true" (the operator's intent), AND
//   * a RESEND_API_KEY is present (the capability actually exists).
// Either missing ⇒ "off" ⇒ send() is a no-op + structured log, never throws —
// so nothing breaks before Nick wires his Resend key at the deploy step.

import { envFlag } from "../offline/sw-flags.ts";

export type EmailMode = "send" | "off";

// Decide whether the layer sends or no-ops, from the two armed conditions.
// "send" ONLY when intent AND capability are both present; otherwise "off".
export function emailMode({
  enabled,
  hasKey,
}: {
  enabled: boolean;
  hasKey: boolean;
}): EmailMode {
  return enabled && hasKey ? "send" : "off";
}

// Resolve the live mode from the environment at CALL time (never cached at
// module load — the same build can be armed by setting env vars without a
// rebuild). EMAIL_ENABLED reuses the strict "true"-only allowlist from
// envFlag; a present-and-non-empty RESEND_API_KEY is the capability check.
export function emailModeFromEnv(): EmailMode {
  return emailMode({
    enabled: envFlag(process.env.EMAIL_ENABLED),
    hasKey: (process.env.RESEND_API_KEY ?? "").trim().length > 0,
  });
}
