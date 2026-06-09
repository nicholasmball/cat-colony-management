import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// Service-role helpers for the E2E harness.
//
// SAFETY: this module is the ONLY place the service-role key is used, and only
// ever on the node side (global setup / teardown / fixtures) — NEVER in the
// browser. Every helper writes its created IDs to a run-state file so teardown
// can delete exactly — and only — what this run created. We never read, modify,
// or delete any pre-existing org/user/data.
// ─────────────────────────────────────────────────────────────────────────────

export type Role = "admin" | "caretaker" | "feeder";

export const RUN_STATE_PATH = join(__dirname, "..", ".run-state.json");
export const AUTH_DIR = join(__dirname, "..", ".auth");

export type CreatedUser = {
  id: string;
  email: string;
  password: string;
  role: Role;
};

export type RunState = {
  orgId: string | null;
  orgName: string | null;
  users: CreatedUser[];
};

// A single source of truth for the run's created IDs, persisted to disk so the
// teardown (a separate process) can clean up everything setup created.
export function readRunState(): RunState {
  if (!existsSync(RUN_STATE_PATH)) {
    return { orgId: null, orgName: null, users: [] };
  }
  return JSON.parse(readFileSync(RUN_STATE_PATH, "utf8")) as RunState;
}

export function writeRunState(state: RunState): void {
  mkdirSync(dirname(RUN_STATE_PATH), { recursive: true });
  writeFileSync(RUN_STATE_PATH, JSON.stringify(state, null, 2));
}

export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — check .env.e2e",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Create a confirmed auth user with a known password. Emails use the reserved
// `.invalid` TLD (RFC 2606) so they can never collide with a real volunteer.
export async function createTestUser(
  svc: SupabaseClient,
  role: Role,
): Promise<CreatedUser> {
  const uuid = randomUUID();
  const email = `e2e+${uuid}@scot-e2e.invalid`;
  const password = `E2e!${uuid}`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createTestUser failed: ${error?.message ?? "no user"}`);
  }
  return { id: data.user.id, email, password, role };
}

// Create the throwaway org via the SAME RPC the app uses (create_organisation),
// so the org + admin membership + seeded defaults (urgency levels, alert
// settings) all match production exactly. The RPC keys off auth.uid(), so we
// call it as the admin user via a short-lived anon session rather than the
// service role.
export async function createTestOrg(
  admin: CreatedUser,
): Promise<{ orgId: string; orgName: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await userClient.auth.signInWithPassword({
    email: admin.email,
    password: admin.password,
  });
  if (signInError) {
    throw new Error(`createTestOrg sign-in failed: ${signInError.message}`);
  }
  const orgName = `E2E ${new Date().toISOString()}-${randomUUID().slice(0, 8)}`;
  const { data, error } = await userClient.rpc("create_organisation", {
    p_name: orgName,
  });
  await userClient.auth.signOut();
  if (error || typeof data !== "string") {
    throw new Error(
      `create_organisation RPC failed: ${error?.message ?? "no org id"}`,
    );
  }
  return { orgId: data, orgName };
}

// Add a membership row directly via the service role (RLS bypassed). Used for
// the caretaker + feeder, who join the admin's org.
export async function addMembership(
  svc: SupabaseClient,
  orgId: string,
  userId: string,
  role: Role,
): Promise<void> {
  const { error } = await svc.from("memberships").insert({
    organisation_id: orgId,
    user_id: userId,
    role,
  });
  if (error) throw new Error(`addMembership failed: ${error.message}`);
}

// Delete the org. FKs are ON DELETE CASCADE from organisations, so this removes
// colonies, cats, feeding_events, cat_sightings, incidents, incident_comments,
// attachments, notifications, memberships, etc. for the org in one shot.
export async function deleteOrgCascade(
  svc: SupabaseClient,
  orgId: string,
): Promise<void> {
  const { error } = await svc.from("organisations").delete().eq("id", orgId);
  if (error) throw new Error(`deleteOrgCascade failed: ${error.message}`);
}

export async function deleteUser(
  svc: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await svc.auth.admin.deleteUser(userId);
  // A user already gone is fine; anything else is a real failure.
  if (error && !/not found/i.test(error.message)) {
    throw new Error(`deleteUser failed: ${error.message}`);
  }
}

export function storageStatePath(role: Role): string {
  return join(AUTH_DIR, `${role}.json`);
}
