// Pure, dependency-free guard for R2 object keys. Every photo key the app mints
// is scoped to the caller's org as `org/{orgId}/…` (see app/api/photos/presign).
// This helper is the single rule that confirms a key really is under a given
// org's prefix, so a client-supplied key can never be persisted or read back
// across orgs. Kept free of server-only/Supabase/Next so it is trivially
// unit-testable and shared by the write actions and the read path (lib/photo).
export function isKeyInOrg(
  key: string | null | undefined,
  orgId: string | null | undefined,
): boolean {
  if (!key || !orgId) return false;
  return key.startsWith(`org/${orgId}/`);
}
