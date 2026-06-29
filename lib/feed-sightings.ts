// Pure mapper from the tap-to-mark-seen feeding grid's UI state to the
// `sightings[]` the /api/feedings route expects. NO React / Supabase / Next
// imports so the precedence rules are unit-testable without a DOM or a DB.
//
// The grid replaced the per-cat tri-toggle (components/feed-form.tsx): a feeder
// TAPS the cats they saw (→ seen) and may flag a cat as a problem (→ concern,
// which overrides seen/not-seen). Anything left un-tapped is "not seen" — but
// only WRITTEN as not_seen when the "I checked the whole colony" box is ON; with
// the box OFF (a partial round) un-tapped cats are omitted entirely so a
// part-round never mass-marks cats not-seen by accident.
//
// No API/DB change: the output statuses are the existing cat_sighting enum
// (seen | not_seen | concern); the form attaches a client UUID per entry.

import type { SightingStatus } from "./api/feeding-input.ts";

// The grid's per-cat selection. Sets keyed by cat id; `wholeColony` is the
// confirm checkbox near Save (default ON).
export type SightingSelection = {
  seen: ReadonlySet<string>;
  concern: ReadonlySet<string>;
  wholeColony: boolean;
};

// Only the id is needed to map; the form passes its full Cat[] (extra fields
// ignored), so this stays decoupled from the page's row shape.
export type CatLike = { id: string };

export type BuiltSighting = { catId: string; status: SightingStatus };

// Status precedence, evaluated per cat:
//   concern  (flagged)                         — overrides everything
//   seen     (tapped, not flagged)
//   not_seen (un-tapped, not flagged) — ONLY when wholeColony is ON
//   omit     (un-tapped, not flagged, wholeColony OFF) — no sighting written
//
// So the box ON = a full write (seen + not_seen + concern); box OFF = a partial
// round (only seen + concern; un-tapped cats produce no row).
export function buildSightings(
  cats: readonly CatLike[],
  { seen, concern, wholeColony }: SightingSelection,
): BuiltSighting[] {
  const out: BuiltSighting[] = [];
  for (const cat of cats) {
    if (concern.has(cat.id)) {
      out.push({ catId: cat.id, status: "concern" });
    } else if (seen.has(cat.id)) {
      out.push({ catId: cat.id, status: "seen" });
    } else if (wholeColony) {
      out.push({ catId: cat.id, status: "not_seen" });
    }
    // else: un-tapped, unflagged, partial round → omitted (neutral, no row).
  }
  return out;
}

export type SightingCounts = {
  seen: number;
  notSeen: number;
  problem: number;
};

// The live "N of M seen · K not seen · P problem" counts for the aria-live
// region. The not-seen count EXCLUDES concern tiles (a flagged cat is a problem,
// not a not-seen): notSeen = total − seen − problem. Independent of wholeColony
// — it reflects the current tile states, which is the feeder's last-chance check
// before Save.
export function countSightings(
  cats: readonly CatLike[],
  {
    seen,
    concern,
  }: { seen: ReadonlySet<string>; concern: ReadonlySet<string> },
): SightingCounts {
  let seenCount = 0;
  let problem = 0;
  for (const cat of cats) {
    if (concern.has(cat.id)) problem += 1;
    else if (seen.has(cat.id)) seenCount += 1;
  }
  return {
    seen: seenCount,
    problem,
    notSeen: cats.length - seenCount - problem,
  };
}
