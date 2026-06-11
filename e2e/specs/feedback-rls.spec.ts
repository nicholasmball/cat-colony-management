import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  addMembership,
  createTestOrg,
  createTestUser,
  deleteOrgCascade,
  deleteUser,
  serviceClient,
  type CreatedUser,
} from "../helpers/admin";

// ─────────────────────────────────────────────────────────────────────────────
// RLS NEGATIVE MATRIX for the `feedback` table (AC18-AC25), proven as REAL
// authenticated users against the PROD Supabase — NOT a policy read.
//
// This spec hits the database directly with supabase-js (anon key + per-user
// JWT from signInWithPassword); it does NOT depend on the deployed feedback UI,
// so it is the part of Step-5 that runs for real now. The policies under test
// (verified live on prod):
//   • INSERT with-check: reporter_id = auth.uid()
//                        AND has_org_role(org,{admin,caretaker,feeder})
//   • SELECT using:      reporter_id = auth.uid()
//   • NO update/delete policy → members can never move status/vibecodes_task_id.
//
// SAFETY / ISOLATION: this spec provisions its OWN throwaway orgs + users (it
// does not reuse the shared global-setup sessions, to keep the matrix
// self-contained incl. a genuine 2nd org for the cross-org case), records every
// created id, and deletes + VERIFIES-gone all of them in afterAll — the same
// teardown discipline as the rest of the suite. Emails use the reserved
// `.invalid` TLD so they can never collide with a real volunteer.
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// A supabase-js client authenticated as one real user (anon key + their JWT),
// exactly the surface the browser app gets — RLS applies in full.
async function userClient(user: CreatedUser): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error)
    throw new Error(`sign-in failed for ${user.role}: ${error.message}`);
  return client;
}

const svc = serviceClient();

// Org X: admin + feeder + caretaker (members A/B for same-org isolation).
let orgX: string;
let adminX: CreatedUser;
let feederX: CreatedUser; // "member A"
let caretakerX: CreatedUser; // "member B"
// Org Y: a separate org with its own member, for the cross-org case (AC21).
let orgY: string;
let memberY: CreatedUser;

const createdUsers: CreatedUser[] = [];
const createdOrgs: string[] = [];

test.beforeAll(async () => {
  // ── Org X ──
  adminX = await createTestUser(svc, "admin");
  createdUsers.push(adminX);
  const x = await createTestOrg(adminX);
  orgX = x.orgId;
  createdOrgs.push(orgX);

  feederX = await createTestUser(svc, "feeder");
  await addMembership(svc, orgX, feederX.id, "feeder");
  createdUsers.push(feederX);

  caretakerX = await createTestUser(svc, "caretaker");
  await addMembership(svc, orgX, caretakerX.id, "caretaker");
  createdUsers.push(caretakerX);

  // ── Org Y (separate org + member) ──
  const adminY = await createTestUser(svc, "admin");
  createdUsers.push(adminY);
  const y = await createTestOrg(adminY);
  orgY = y.orgId;
  createdOrgs.push(orgY);
  memberY = adminY; // adminY is a member of org Y only
});

test.afterAll(async () => {
  // Delete orgs (cascades to feedback rows + memberships), then auth users, then
  // VERIFY nothing this spec created is left behind.
  for (const orgId of createdOrgs) {
    try {
      await deleteOrgCascade(svc, orgId);
    } catch (err) {
      console.error(
        `[feedback-rls teardown] org delete failed (${orgId}):`,
        err,
      );
    }
  }
  for (const u of createdUsers) {
    try {
      await deleteUser(svc, u.id);
    } catch (err) {
      console.error(
        `[feedback-rls teardown] user delete failed (${u.email}):`,
        err,
      );
    }
  }
  // Verify.
  for (const orgId of createdOrgs) {
    const { data } = await svc
      .from("organisations")
      .select("id")
      .eq("id", orgId)
      .maybeSingle();
    expect(data, `org ${orgId} should be deleted`).toBeNull();
  }
  for (const u of createdUsers) {
    const { data } = await svc.auth.admin.getUserById(u.id);
    expect(data.user, `user ${u.email} should be deleted`).toBeNull();
  }
});

test.describe("feedback RLS matrix (real authenticated users, prod DB)", () => {
  // AC18/AC19 — the happy path the policy is built for: a member may INSERT a
  // row for THEIR org, attributed to THEMSELVES. (feeder == member A here, to
  // also prove the lowest-privilege role can file feedback — PO MUST #3.)
  test("AC18/AC19: a member can INSERT their own feedback (self + own org)", async () => {
    const client = await userClient(feederX);
    const { data, error } = await client
      .from("feedback")
      .insert({
        organisation_id: orgX,
        reporter_id: feederX.id,
        kind: "bug",
        message: `rls-ok ${randomUUID()}`,
      })
      .select("id, status")
      .single();

    expect(error, error?.message).toBeNull();
    expect(data?.id).toBeTruthy();
    // AC: status defaults to 'new' (member never sets it).
    expect(data?.status).toBe("new");
  });

  // AC22 — forged attribution: a member cannot insert a row attributed to
  // someone else. The with-check (reporter_id = auth.uid()) must reject it; no
  // row is written.
  test("AC22: a member CANNOT insert a row with someone else's reporter_id", async () => {
    const client = await userClient(feederX);
    const { data, error } = await client
      .from("feedback")
      .insert({
        organisation_id: orgX,
        reporter_id: caretakerX.id, // forged — not the caller
        kind: "bug",
        message: `forged ${randomUUID()}`,
      })
      .select("id");

    // RLS with-check violation → error, no data.
    expect(
      error,
      "forged-reporter insert must be rejected by RLS",
    ).not.toBeNull();
    expect(data).toBeNull();

    // Defence in depth: confirm via the service role that NO forged row landed.
    const { data: rows } = await svc
      .from("feedback")
      .select("id")
      .eq("reporter_id", caretakerX.id);
    expect(
      rows ?? [],
      "no forged row should exist for the victim",
    ).toHaveLength(0);
  });

  // AC22b — a member cannot file feedback against an org they don't belong to
  // (has_org_role(orgY,...) is false for feederX). Even with their own
  // reporter_id, the membership half of the with-check blocks it.
  test("AC22b: a member CANNOT insert feedback for an org they don't belong to", async () => {
    const client = await userClient(feederX);
    const { data, error } = await client
      .from("feedback")
      .insert({
        organisation_id: orgY, // feederX is NOT a member of org Y
        reporter_id: feederX.id, // own id, but wrong org
        kind: "idea",
        message: `wrong-org ${randomUUID()}`,
      })
      .select("id");

    expect(
      error,
      "insert into a non-member org must be rejected",
    ).not.toBeNull();
    expect(data).toBeNull();
  });

  // AC20 — same-org read isolation: member A cannot SELECT member B's row.
  test("AC20: member A CANNOT SELECT member B's feedback (same org)", async () => {
    // caretakerX (member B) writes a row.
    const bClient = await userClient(caretakerX);
    const marker = `b-private ${randomUUID()}`;
    const { data: bRow, error: bErr } = await bClient
      .from("feedback")
      .insert({
        organisation_id: orgX,
        reporter_id: caretakerX.id,
        kind: "idea",
        message: marker,
      })
      .select("id")
      .single();
    expect(bErr, bErr?.message).toBeNull();
    const bRowId = bRow!.id;

    // feederX (member A, same org) tries to read it by id.
    const aClient = await userClient(feederX);
    const { data: seen } = await aClient
      .from("feedback")
      .select("id, message")
      .eq("id", bRowId);
    // SELECT using (reporter_id = auth.uid()) filters B's row out for A → empty.
    expect(seen ?? [], "member A must not see member B's row").toHaveLength(0);

    // And A also can't find it by scanning their visible set for the marker.
    const { data: allA } = await aClient.from("feedback").select("message");
    expect(
      (allA ?? []).some((r) => r.message === marker),
      "B's message must never appear in A's results",
    ).toBe(false);
  });

  // AC21 — cross-org read isolation: a member of org Y cannot SELECT a row that
  // belongs to org X (and vice-versa). The select-own policy enforces this
  // regardless of org, but we prove it with a genuine 2nd org + member.
  test("AC21: a user in org Y cannot SELECT a feedback row from org X", async () => {
    // adminX writes a row in org X.
    const xClient = await userClient(adminX);
    const marker = `x-org ${randomUUID()}`;
    const { data: xRow, error: xErr } = await xClient
      .from("feedback")
      .insert({
        organisation_id: orgX,
        reporter_id: adminX.id,
        kind: "bug",
        message: marker,
      })
      .select("id")
      .single();
    expect(xErr, xErr?.message).toBeNull();
    const xRowId = xRow!.id;

    // memberY (org Y only) tries to read org X's row.
    const yClient = await userClient(memberY);
    const { data: seen } = await yClient
      .from("feedback")
      .select("id")
      .eq("id", xRowId);
    expect(seen ?? [], "org-Y member must not see an org-X row").toHaveLength(
      0,
    );
  });

  // AC23 — members can never flip status / vibecodes_task_id: there is NO update
  // policy, so an UPDATE matches zero rows (RLS hides the row from the update's
  // USING set). The value must be unchanged afterwards (verified via service role).
  test("AC23: a member CANNOT UPDATE status / vibecodes_task_id", async () => {
    const client = await userClient(feederX);
    const { data: row } = await client
      .from("feedback")
      .insert({
        organisation_id: orgX,
        reporter_id: feederX.id,
        kind: "bug",
        message: `no-update ${randomUUID()}`,
      })
      .select("id, status")
      .single();
    const id = row!.id;
    expect(row!.status).toBe("new");

    // Attempt the privilege escalation a malicious member would try.
    const { data: updated, error: updErr } = await client
      .from("feedback")
      .update({ status: "done", vibecodes_task_id: "TASK-HIJACK" })
      .eq("id", id)
      .select("id");

    // No update policy → the update affects zero rows (no error, empty result).
    expect(updErr, updErr?.message ?? "").toBeNull();
    expect(
      updated ?? [],
      "update must affect zero rows for a member",
    ).toHaveLength(0);

    // Verify via the service role the row is untouched.
    const { data: after } = await svc
      .from("feedback")
      .select("status, vibecodes_task_id")
      .eq("id", id)
      .single();
    expect(after?.status, "status must remain 'new'").toBe("new");
    expect(
      after?.vibecodes_task_id,
      "vibecodes_task_id must remain null",
    ).toBeNull();
  });

  // AC24/AC25 — the BOT path: the service role bypasses RLS, can read EVERY org's
  // rows, and is the only actor that may move status / vibecodes_task_id.
  test("AC24/AC25: the service role can read all + set status/vibecodes_task_id", async () => {
    // A fresh member row to be 'triaged' by the bot.
    const client = await userClient(adminX);
    const { data: row } = await client
      .from("feedback")
      .insert({
        organisation_id: orgX,
        reporter_id: adminX.id,
        kind: "idea",
        message: `bot-triage ${randomUUID()}`,
      })
      .select("id")
      .single();
    const id = row!.id;

    // Service role reads it (RLS-exempt) regardless of reporter.
    const { data: seen, error: readErr } = await svc
      .from("feedback")
      .select("id, status")
      .eq("id", id)
      .single();
    expect(readErr, readErr?.message).toBeNull();
    expect(seen?.id).toBe(id);

    // Service role moves status + stamps the board task id (the bot transition).
    const { data: moved, error: updErr } = await svc
      .from("feedback")
      .update({ status: "triaged", vibecodes_task_id: "VC-123" })
      .eq("id", id)
      .select("status, vibecodes_task_id")
      .single();
    expect(updErr, updErr?.message).toBeNull();
    expect(moved?.status).toBe("triaged");
    expect(moved?.vibecodes_task_id).toBe("VC-123");
  });
});
