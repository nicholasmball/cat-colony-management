// Pure decision logic for service-worker behaviour. NO DOM, NO React — the only
// branching lives here so it is node:test-able; the client component is a thin
// caller (see components/sw-register.tsx).
//
// PHASE 0 of the offline-first rollout is the SAFETY FOUNDATION: a kill-switch +
// flag machinery that ship BEFORE any caching service worker exists. There is no
// real caching SW yet (Phase 3 supplies it) — but the mode logic below is the
// final contract and won't change when the real SW lands.

export type SwMode = "kill" | "register" | "off";

// Decide what the registration component should do, from two boolean flags.
//
// Priority order is deliberate and tested as a full truth table:
//   1. kill === true        → "kill"     (ALWAYS wins, even if enabled — this is
//                                          the emergency unregister-everything path)
//   2. enabled === true     → "register" (the real offline SW; Phase 3 wires it —
//                                          in Phase 0 this is a no-op placeholder)
//   3. otherwise            → "off"      (do nothing / ensure none registered)
export function swMode({
  enabled,
  kill,
}: {
  enabled: boolean;
  kill: boolean;
}): SwMode {
  if (kill) return "kill";
  if (enabled) return "register";
  return "off";
}

// Contract for coercing a `NEXT_PUBLIC_*` env var (a string | undefined at the
// edge) into a boolean for swMode(). Deliberately STRICT: only the exact string
// "true" (case-insensitive, trimmed) is truthy. Everything else — undefined, "",
// "false", "0", "1", "yes", "TRUE " with junk — is false. A strict allowlist
// keeps the panic button predictable: a typo can never accidentally arm a flag.
export function envFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}
