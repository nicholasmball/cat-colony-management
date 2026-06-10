import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_LIMIT,
  collectUserIds,
  buildFeedingSection,
  buildIncidentSection,
  lastFedFromRows,
  type RawFeedingEvent,
  type RawIncident,
} from "./colony-history.ts";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const GHOST = "33333333-3333-3333-3333-333333333333"; // not in the email map

function emailMap(): Map<string, string> {
  return new Map([
    [U1, "maria@example.org"],
    [U2, "jose@example.org"],
  ]);
}

function feeding(over: Partial<RawFeedingEvent> = {}): RawFeedingEvent {
  return {
    fed: true,
    problem: false,
    food_issue: false,
    danger: false,
    notes: null,
    feeder_id: U1,
    observed_at: "2026-06-08T18:40:00Z",
    ...over,
  };
}

function incident(over: Partial<RawIncident> = {}): RawIncident {
  return {
    id: "inc-1",
    type: "injured_cat",
    status: "open",
    cat_id: null,
    urgency_level_id: null,
    reported_by: U2,
    occurred_at: "2026-06-05T21:00:00Z",
    ...over,
  };
}

// ── collectUserIds ──────────────────────────────────────────────────────────
test("collectUserIds returns distinct non-null ids across both lists", () => {
  const ids = collectUserIds(
    [feeding({ feeder_id: U1 }), feeding({ feeder_id: U1 })],
    [incident({ reported_by: U2 }), incident({ reported_by: null })],
  );
  assert.deepEqual(ids.sort(), [U1, U2].sort());
});

test("collectUserIds is empty when nothing is attributed", () => {
  assert.deepEqual(
    collectUserIds(
      [feeding({ feeder_id: null })],
      [incident({ reported_by: null })],
    ),
    [],
  );
});

// ── buildFeedingSection ───────────────────────────────────────────────────────
test("buildFeedingSection resolves who and passes fed/notes (happy path)", () => {
  const out = buildFeedingSection(
    [feeding({ fed: true, notes: "all good" })],
    emailMap(),
  );
  assert.equal(out.hasMore, false);
  assert.deepEqual(out.rows, [
    {
      fed: true,
      tone: "good",
      flags: [],
      observedAt: "2026-06-08T18:40:00Z",
      who: "maria@example.org",
      notes: "all good",
    },
  ]);
});

test("buildFeedingSection marks a not-fed row with the bad tone", () => {
  const out = buildFeedingSection([feeding({ fed: false })], emailMap());
  assert.equal(out.rows[0].fed, false);
  assert.equal(out.rows[0].tone, "bad");
});

test("buildFeedingSection emits only the flags that are set, in order", () => {
  const noFlags = buildFeedingSection([feeding()], emailMap());
  assert.deepEqual(noFlags.rows[0].flags, []);

  const allFlags = buildFeedingSection(
    [feeding({ problem: true, food_issue: true, danger: true })],
    emailMap(),
  );
  assert.deepEqual(allFlags.rows[0].flags, ["problem", "food_issue", "danger"]);

  const some = buildFeedingSection(
    [feeding({ problem: false, food_issue: true, danger: true })],
    emailMap(),
  );
  assert.deepEqual(some.rows[0].flags, ["food_issue", "danger"]);
});

test("buildFeedingSection renders name-less for null and unresolved feeders", () => {
  const out = buildFeedingSection(
    [feeding({ feeder_id: null }), feeding({ feeder_id: GHOST })],
    emailMap(),
  );
  assert.equal(out.rows[0].who, null);
  assert.equal(out.rows[1].who, null); // departed volunteer → omitted, not UUID
});

test("buildFeedingSection empty list yields no rows and no overflow", () => {
  const out = buildFeedingSection([], emailMap());
  assert.deepEqual(out.rows, []);
  assert.equal(out.hasMore, false);
});

test("buildFeedingSection caps at 10 and flags overflow when 11 returned", () => {
  const out = buildFeedingSection(
    Array.from({ length: 11 }, () => feeding()),
    emailMap(),
  );
  assert.equal(out.rows.length, HISTORY_LIMIT);
  assert.equal(out.hasMore, true);
});

test("buildFeedingSection of exactly 10 does not flag overflow", () => {
  const out = buildFeedingSection(
    Array.from({ length: 10 }, () => feeding()),
    emailMap(),
  );
  assert.equal(out.rows.length, 10);
  assert.equal(out.hasMore, false);
});

// ── buildIncidentSection ──────────────────────────────────────────────────────
test("buildIncidentSection maps an incident with resolved reporter", () => {
  const out = buildIncidentSection(
    [
      incident({
        id: "inc-9",
        type: "poisoning",
        status: "closed",
        cat_id: "cat-1",
        urgency_level_id: "lvl-1",
        reported_by: U2,
      }),
    ],
    emailMap(),
  );
  assert.deepEqual(out.rows[0], {
    id: "inc-9",
    type: "poisoning",
    status: "closed",
    catId: "cat-1",
    urgencyLevelId: "lvl-1",
    occurredAt: "2026-06-05T21:00:00Z",
    who: "jose@example.org",
  });
});

test("buildIncidentSection renders name-less for a null/unresolved reporter", () => {
  const out = buildIncidentSection(
    [incident({ reported_by: null }), incident({ reported_by: GHOST })],
    emailMap(),
  );
  assert.equal(out.rows[0].who, null);
  assert.equal(out.rows[1].who, null);
});

test("buildIncidentSection keeps ALL statuses (open + resolved + closed)", () => {
  const out = buildIncidentSection(
    [
      incident({ id: "a", status: "open" }),
      incident({ id: "b", status: "resolved" }),
      incident({ id: "c", status: "closed" }),
    ],
    emailMap(),
  );
  assert.deepEqual(
    out.rows.map((r) => r.status),
    ["open", "resolved", "closed"],
  );
});

test("buildIncidentSection empty list yields no rows and no overflow", () => {
  const out = buildIncidentSection([], emailMap());
  assert.deepEqual(out.rows, []);
  assert.equal(out.hasMore, false);
});

test("buildIncidentSection caps at 10 and flags overflow when 11 returned", () => {
  const out = buildIncidentSection(
    Array.from({ length: 11 }, () => incident()),
    emailMap(),
  );
  assert.equal(out.rows.length, HISTORY_LIMIT);
  assert.equal(out.hasMore, true);
});

// ── lastFedFromRows ───────────────────────────────────────────────────────────
test("lastFedFromRows returns the newest fed row's observed_at", () => {
  const out = lastFedFromRows([
    feeding({ fed: true, observed_at: "2026-06-08T18:40:00Z" }),
    feeding({ fed: true, observed_at: "2026-06-07T18:40:00Z" }),
  ]);
  assert.equal(out.fedAt, "2026-06-08T18:40:00Z");
});

test("lastFedFromRows skips a newer not-fed correction to the last fed row", () => {
  const out = lastFedFromRows([
    feeding({ fed: false, observed_at: "2026-06-08T18:40:00Z" }),
    feeding({ fed: true, observed_at: "2026-06-07T18:40:00Z" }),
  ]);
  assert.equal(out.fedAt, "2026-06-07T18:40:00Z");
});

test("lastFedFromRows is null when never fed (only not-fed rows)", () => {
  const out = lastFedFromRows([feeding({ fed: false })]);
  assert.equal(out.fedAt, null);
});

test("lastFedFromRows is null for an empty history", () => {
  assert.equal(lastFedFromRows([]).fedAt, null);
});
