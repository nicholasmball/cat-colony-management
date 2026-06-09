import { rmSync } from "node:fs";
import {
  deleteOrgCascade,
  deleteUser,
  readRunState,
  RUN_STATE_PATH,
  serviceClient,
} from "./helpers/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Global teardown: delete EVERYTHING this run created — the test org (cascades
// to colonies/cats/feeding/incidents/notifications/memberships) and every auth
// user — then VERIFY via the service role that none are left behind.
// ─────────────────────────────────────────────────────────────────────────────

export default async function globalTeardown() {
  const state = readRunState();
  const svc = serviceClient();

  // 1) Org first (cascades to all its domain data + membership rows).
  if (state.orgId) {
    try {
      await deleteOrgCascade(svc, state.orgId);
    } catch (err) {
      console.error(`[e2e teardown] org delete failed:`, err);
    }
  }

  // 2) Auth users.
  for (const user of state.users) {
    try {
      await deleteUser(svc, user.id);
    } catch (err) {
      console.error(`[e2e teardown] user delete failed (${user.email}):`, err);
    }
  }

  // 3) Verify gone.
  let clean = true;
  if (state.orgId) {
    const { data: org } = await svc
      .from("organisations")
      .select("id")
      .eq("id", state.orgId)
      .maybeSingle();
    if (org) {
      clean = false;
      console.error(
        `[e2e teardown] VERIFY FAIL: org ${state.orgId} still exists`,
      );
    }
  }
  for (const user of state.users) {
    const { data } = await svc.auth.admin.getUserById(user.id);
    if (data.user) {
      clean = false;
      console.error(
        `[e2e teardown] VERIFY FAIL: user ${user.email} still exists`,
      );
    }
  }

  if (clean) {
    console.log(
      `[e2e teardown] verified clean: org=${state.orgId ?? "(none)"} + ${
        state.users.length
      } user(s) deleted.`,
    );
    // Only drop the run-state once we've confirmed everything is gone.
    try {
      rmSync(RUN_STATE_PATH, { force: true });
    } catch {
      /* best effort */
    }
  } else {
    console.error(
      "[e2e teardown] residual test data may remain — run-state kept for a retry.",
    );
  }
}
