import "server-only";
import { presignGet, r2Configured } from "@/lib/storage/r2";
import { isKeyInOrg } from "@/lib/photo-key";

// Turn a stored object key into a short-lived URL usable as an <img src>.
// Returns null when there's no photo or storage isn't configured (callers
// fall back to a placeholder).
//
// The key MUST be under the caller's org prefix (`org/{orgId}/…`). This is the
// single read-side guard covering all three entity types (cat / cat_report /
// incident): a stored key that somehow isn't org-scoped (legacy/tampered) is
// never turned into a signed GET, so photos can't leak across orgs.
export async function photoSrc(
  key: string | null | undefined,
  orgId: string,
): Promise<string | null> {
  if (!key || !r2Configured()) return null;
  if (!isKeyInOrg(key, orgId)) return null;
  try {
    return await presignGet(key);
  } catch {
    return null;
  }
}
