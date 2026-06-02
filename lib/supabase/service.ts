import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — BYPASSES Row-Level Security.
 * SERVER-ONLY. Never import this into a Client Component or expose the key.
 * Use only for trusted server-side jobs (e.g. system notifications) that must
 * operate across organisations.
 */
export function createServiceClient() {
  if (typeof window !== "undefined") {
    throw new Error("createServiceClient() must never run in the browser");
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
