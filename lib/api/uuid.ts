// Pure, dependency-free guard for the client-supplied UUIDs the offline-first
// transport relies on. Phase 1 introduces JSON route handlers that accept a
// client-generated UUID as the row's primary key so a replay can upsert the
// same id idempotently (onConflict:"id", ignoreDuplicates). The id is therefore
// untrusted input and MUST be validated to a real UUID before it reaches
// Postgres — a malformed id would otherwise either error at insert or, worse,
// let a caller probe the PK space. Kept free of any framework imports so it is
// trivially unit-testable and shared by every input lib.

// Canonical RFC 4122 form, case-insensitive: 8-4-4-4-12 hex. crypto.randomUUID()
// always emits this shape (lowercase v4); we accept any well-formed UUID so a
// future client UUID strategy isn't locked out, but reject anything else.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
