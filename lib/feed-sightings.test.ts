import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSightings,
  countSightings,
  type CatLike,
} from "./feed-sightings.ts";

const cats: CatLike[] = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

function sel(seen: string[], concern: string[], wholeColony: boolean) {
  return {
    seen: new Set(seen),
    concern: new Set(concern),
    wholeColony,
  };
}

// ── buildSightings: wholeColony ON (full round) ──────────────────────────────
test("wholeColony ON: tapped → seen, un-tapped → not_seen, flagged → concern", () => {
  const out = buildSightings(cats, sel(["a"], ["b"], true));
  assert.deepEqual(out, [
    { catId: "a", status: "seen" },
    { catId: "b", status: "concern" },
    { catId: "c", status: "not_seen" },
    { catId: "d", status: "not_seen" },
  ]);
});

test("wholeColony ON: every un-tapped, unflagged cat is written not_seen", () => {
  const out = buildSightings(cats, sel([], [], true));
  assert.deepEqual(
    out.map((s) => s.status),
    ["not_seen", "not_seen", "not_seen", "not_seen"],
  );
});

// ── buildSightings: wholeColony OFF (partial round) ──────────────────────────
test("wholeColony OFF: tapped → seen, flagged → concern, un-tapped → OMITTED", () => {
  const out = buildSightings(cats, sel(["a"], ["b"], false));
  assert.deepEqual(out, [
    { catId: "a", status: "seen" },
    { catId: "b", status: "concern" },
  ]);
  // c and d (un-tapped) produce no rows — no false not-seen on a partial round.
  assert.equal(
    out.find((s) => s.catId === "c"),
    undefined,
  );
  assert.equal(
    out.find((s) => s.catId === "d"),
    undefined,
  );
});

test("wholeColony OFF + zero taps → empty round (no sightings)", () => {
  assert.deepEqual(buildSightings(cats, sel([], [], false)), []);
});

// ── buildSightings: concern precedence ───────────────────────────────────────
test("concern overrides a TAPPED cat (flag wins; single concern row)", () => {
  const out = buildSightings(cats, sel(["a"], ["a"], true));
  const a = out.filter((s) => s.catId === "a");
  assert.deepEqual(a, [{ catId: "a", status: "concern" }]);
});

test("concern overrides an UN-TAPPED cat even with wholeColony ON", () => {
  const out = buildSightings(cats, sel([], ["a"], true));
  assert.equal(out.find((s) => s.catId === "a")?.status, "concern");
});

// ── buildSightings: empty colony ─────────────────────────────────────────────
test("empty colony → [] regardless of selection / checkbox", () => {
  assert.deepEqual(buildSightings([], sel([], [], true)), []);
  assert.deepEqual(buildSightings([], sel(["x"], ["y"], false)), []);
});

// ── buildSightings: order preserved (matches the displayed grid) ─────────────
test("output preserves the cats[] order", () => {
  const out = buildSightings(cats, sel(["d", "a"], [], true));
  assert.deepEqual(
    out.map((s) => s.catId),
    ["a", "b", "c", "d"],
  );
});

// ── countSightings: not-seen EXCLUDES concern ────────────────────────────────
test("countSightings: not-seen excludes concern; seen/problem counted", () => {
  const counts = countSightings(cats, {
    seen: new Set(["a"]),
    concern: new Set(["b"]),
  });
  // a=seen, b=problem, c+d=not seen (concern is NOT counted as not-seen).
  assert.deepEqual(counts, { seen: 1, notSeen: 2, problem: 1 });
});

test("countSightings: a tapped-and-flagged cat counts as problem only", () => {
  const counts = countSightings(cats, {
    seen: new Set(["a"]),
    concern: new Set(["a"]),
  });
  // a is problem (concern wins) → seen 0, problem 1, not-seen 3 (b,c,d).
  assert.deepEqual(counts, { seen: 0, notSeen: 3, problem: 1 });
});

test("countSightings: all un-tapped → all not-seen, no problems", () => {
  const counts = countSightings(cats, {
    seen: new Set(),
    concern: new Set(),
  });
  assert.deepEqual(counts, { seen: 0, notSeen: 4, problem: 0 });
});

test("countSightings: empty colony → all zeros", () => {
  assert.deepEqual(
    countSightings([], { seen: new Set(), concern: new Set() }),
    {
      seen: 0,
      notSeen: 0,
      problem: 0,
    },
  );
});

// ── the count's not-seen tracks buildSightings' not_seen writes (ON) ─────────
test("count.notSeen equals the not_seen rows buildSightings writes when ON", () => {
  const seen = new Set(["a"]);
  const concern = new Set(["b"]);
  const counts = countSightings(cats, { seen, concern });
  const written = buildSightings(cats, {
    seen,
    concern,
    wholeColony: true,
  }).filter((s) => s.status === "not_seen").length;
  assert.equal(written, counts.notSeen);
});
