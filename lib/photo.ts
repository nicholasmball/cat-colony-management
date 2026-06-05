import "server-only";
import { presignGet, r2Configured } from "@/lib/storage/r2";

// Turn a stored object key into a short-lived URL usable as an <img src>.
// Returns null when there's no photo or storage isn't configured (callers
// fall back to a placeholder).
export async function photoSrc(
  key: string | null | undefined,
): Promise<string | null> {
  if (!key || !r2Configured()) return null;
  try {
    return await presignGet(key);
  } catch {
    return null;
  }
}
