// Pure, dependency-free validation for a client-supplied field-observation time
// (the feed form's `observedAt` / the incident form's `occurredAt`). The CORE of
// the offline fix: an offline write is queued in the field at tap-time and only
// reaches the route minutes/hours later on reconnect. If the server stamped the
// row at insert time (the DB `now()` default), every synced field write would
// record the SYNC time, not the true field time. So the client captures the time
// at submit and sends it; this layer turns that untrusted string into a trusted
// ISO timestamp (or undefined, so the route falls back to the DB default).
//
// Kept free of any framework imports so it is trivially unit-testable and shared
// by both input libs (feeding-input.ts, incident-input.ts).

// How far ahead of the server's clock we tolerate before treating a value as
// bogus. Phones drift; a minute or two of skew is normal, so we allow a small
// window. Anything beyond it (a far-future or clearly-wrong clock) is rejected
// in favour of the fallback rather than trusting it.
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

// Parse a client-supplied field-observation timestamp.
//
//   absent (undefined/null)  → undefined  (route omits the column → DB now())
//   valid ISO, not future    → the normalised ISO string
//   valid ISO, future > skew  → undefined (reject-with-fallback → DB now())
//   unparseable / wrong type → undefined (reject-with-fallback → DB now())
//
// We deliberately NEVER fail the request on a bad time — the field write must
// stand (the "never block the update" principle); a missing/garbage time simply
// falls back to server now(), which is the pre-fix behaviour. `now` is injectable
// for tests; defaults to the server clock.
export function parseFieldTimestamp(
  value: unknown,
  now: number = Date.now(),
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return undefined;
  if (ms > now + MAX_FUTURE_SKEW_MS) return undefined;
  return new Date(ms).toISOString();
}
