import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_LIMIT,
  collectUserIds,
  buildSightingSection,
  buildStatusSection,
  type RawSighting,
  type RawStatusChange,
} from "./cat-history.ts";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const GHOST = "33333333-3333-3333-3333-333333333333"; // not in the email map

function emailMap(): Map<string, string> {
  return new Map([
    [U1, "maria@example.org"],
    [U2, "jose@example.org"],
  ]);
}

function sighting(over: Partial<RawSighting> = {}): RawSighting {
  return {
    status: "seen",
    observed_at: "2026-06-08T18:40:00Z",
    feeder_id: U1,
    note: null,
    ...over,
  };
}

function change(over: Partial<RawStatusChange> = {}): RawStatusChange {
  return {
    old_status: "active",
    new_status: "missing",
    created_at: "2026-06-05T21:00:00Z",
    changed_by: U2,
    ...over,
  };
}

// ── collectUserIds ──────────────────────────────────────────────────────────
test("collectUserIds returns distinct non-null ids across both lists", () => {
  const ids = collectUserIds(
    [sighting({ feeder_id: U1 }), sighting({ feeder_id: U1 })],
    [change({ changed_by: U2 }), change({ changed_by: null })],
  );
  assert.deepEqual(ids.sort(), [U1, U2].sort());
});

test("collectUserIds is empty when nothing is attributed", () => {
  assert.deepEqual(
    collectUserIds(
      [sighting({ feeder_id: null })],
      [change({ changed_by: null })],
    ),
    [],
  );
});

// ── buildSightingSection ────────────────────────────────────────────────────
test("buildSightingSection resolves who, passes status/note (happy path)", () => {
  const out = buildSightingSection(
    [sighting({ status: "concern", note: "thin, hiding" })],
    emailMap(),
  );
  assert.equal(out.hasMore, false);
  assert.deepEqual(out.rows, [
    {
      status: "concern",
      observedAt: "2026-06-08T18:40:00Z",
      who: "maria@example.org",
      note: "thin, hiding",
    },
  ]);
});

test("buildSightingSection renders name-less for null and unresolved feeders", () => {
  const out = buildSightingSection(
    [sighting({ feeder_id: null }), sighting({ feeder_id: GHOST })],
    emailMap(),
  );
  assert.equal(out.rows[0].who, null);
  assert.equal(out.rows[1].who, null); // deleted volunteer → omitted, not UUID
});

test("buildSightingSection empty list yields no rows and no overflow", () => {
  const out = buildSightingSection([], emailMap());
  assert.deepEqual(out.rows, []);
  assert.equal(out.hasMore, false);
});

test("buildSightingSection caps at 10 and flags overflow when 11 returned", () => {
  const rows = Array.from({ length: 11 }, () => sighting());
  const out = buildSightingSection(rows, emailMap());
  assert.equal(out.rows.length, HISTORY_LIMIT);
  assert.equal(out.hasMore, true);
});

test("buildSightingSection of exactly 10 does not flag overflow", () => {
  const out = buildSightingSection(
    Array.from({ length: 10 }, () => sighting()),
    emailMap(),
  );
  assert.equal(out.rows.length, 10);
  assert.equal(out.hasMore, false);
});

// ── buildStatusSection ──────────────────────────────────────────────────────
test("buildStatusSection maps an old→new change with resolved who", () => {
  const out = buildStatusSection(
    [change({ old_status: "active", new_status: "missing", changed_by: U2 })],
    emailMap(),
  );
  assert.deepEqual(out.rows[0], {
    isCreation: false,
    oldStatus: "active",
    newStatus: "missing",
    createdAt: "2026-06-05T21:00:00Z",
    who: "jose@example.org",
  });
});

test("buildStatusSection marks a null old_status as the creation row", () => {
  const out = buildStatusSection(
    [change({ old_status: null, new_status: "new_unconfirmed" })],
    emailMap(),
  );
  assert.equal(out.rows[0].isCreation, true);
  assert.equal(out.rows[0].oldStatus, null);
  assert.equal(out.rows[0].newStatus, "new_unconfirmed");
});

test("buildStatusSection renders name-less for a null/system changed_by", () => {
  const out = buildStatusSection([change({ changed_by: null })], emailMap());
  assert.equal(out.rows[0].who, null); // alert-engine change → normal, no name
});

test("buildStatusSection empty list yields no rows and no overflow", () => {
  const out = buildStatusSection([], emailMap());
  assert.deepEqual(out.rows, []);
  assert.equal(out.hasMore, false);
});

test("buildStatusSection caps at 10 and flags overflow when 11 returned", () => {
  const out = buildStatusSection(
    Array.from({ length: 11 }, () => change()),
    emailMap(),
  );
  assert.equal(out.rows.length, HISTORY_LIMIT);
  assert.equal(out.hasMore, true);
});
