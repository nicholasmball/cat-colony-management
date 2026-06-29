// Pure helpers for colony feeding windows (the colony_feeding_windows table,
// migration 0013). A colony has 0..4 ordered daily feed windows, each a
// start + end time. Side-effect-free so the ordering, parsing and per-window
// fed/missed attribution are unit-testable in isolation and shared by the
// authoring forms, every display surface and the alert sweep.
//
// Mirrors lib/feeding-status & lib/cat-concern: time is passed in (a `now` or a
// pre-resolved local-minutes value), nothing reaches out to the clock or DB.

import { localMinutesOfDay, minutesAfterWindow } from "./time.ts";
import { feedingStatus, type FeedingStatus } from "./feeding-status.ts";

// Up to 4 feeding windows per colony (approved design — Option A).
export const MAX_FEEDING_WINDOWS = 4;

// A stored window row (or a candidate one). `id` is absent before insert.
export type FeedingWindowRow = {
  id?: string | null;
  window_start: string | null;
  window_end: string | null;
  position: number;
};

// "07:00" from "07:00" / "07:00:00"; null passes through.
export function hhmm(t: string | null | undefined): string | null {
  return t ? t.slice(0, 5) : null;
}

// "HH:MM[:SS]" → minutes since midnight; null/blank → null.
export function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

// "07:00–08:00" (en-dash). A half-window (one side null) renders the known side
// with an em-dash placeholder; both-null returns "" (callers show "no window").
export function windowRangeLabel(
  start: string | null,
  end: string | null,
): string {
  const s = hhmm(start);
  const e = hhmm(end);
  if (!s && !e) return "";
  return `${s ?? "—"}–${e ?? "—"}`;
}

// The stable per-window identity used in the alert dedup key: the row id when
// it exists, else "p{position}" (so a colony with exactly one window keys the
// same as the legacy single-window behaviour did before any id was assigned).
export function windowKeyOf(w: FeedingWindowRow): string {
  return w.id ?? `p${w.position}`;
}

// Order windows for display + attribution: by position, then start time
// (nulls last), then id for a stable tiebreak. Pure — returns a fresh array.
export function orderWindows<
  T extends {
    position: number;
    window_start: string | null;
    id?: string | null;
  },
>(rows: readonly T[]): T[] {
  return rows.slice().sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    const as = a.window_start;
    const bs = b.window_start;
    if (as !== bs) {
      if (as == null) return 1;
      if (bs == null) return -1;
      return as < bs ? -1 : 1;
    }
    return (a.id ?? "") < (b.id ?? "")
      ? -1
      : (a.id ?? "") > (b.id ?? "")
        ? 1
        : 0;
  });
}

// ── Form parsing (the new + edit colony actions) ─────────────────────────────
export type ParsedWindow = { window_start: string; window_end: string };
export type ParseWindowsResult =
  | { ok: true; windows: ParsedWindow[] }
  | { ok: false; reason: "incomplete"; row: number }
  | { ok: false; reason: "tooMany" };

// Zip the parallel repeated `window_start` / `window_end` fields the editor
// posts into validated rows. Both-empty rows are DROPPED (not an error); a
// half-filled pair is rejected with the 1-based ordinal of the offending
// feeding time; more than the cap is rejected. Pure (no FormData here).
export function parseWindowRows(
  starts: readonly string[],
  ends: readonly string[],
): ParseWindowsResult {
  const n = Math.max(starts.length, ends.length);
  const windows: ParsedWindow[] = [];
  for (let i = 0; i < n; i++) {
    const s = (starts[i] ?? "").trim();
    const e = (ends[i] ?? "").trim();
    if (!s && !e) continue; // both empty → silently dropped
    if (!s || !e) {
      return { ok: false, reason: "incomplete", row: windows.length + 1 };
    }
    windows.push({ window_start: s, window_end: e });
  }
  if (windows.length > MAX_FEEDING_WINDOWS)
    return { ok: false, reason: "tooMany" };
  return { ok: true, windows };
}

// ── Per-window fed attribution ───────────────────────────────────────────────
export type AttribWindow = { key: string; startMinutes: number | null };
export type AttribEvent = {
  localMinutes: number;
  observedAt: string;
  fed: boolean;
};
export type WindowFedState = { fed: boolean; fedAt: string | null };

// Attribute each feeding event to the window it serves and report fed-per-window.
// A window can be "fed" while its sibling is "missed" (the non-negotiable
// behaviour): each event is assigned to the LATEST window whose start ≤ the
// event's local time-of-day (events before all starts fall to the earliest
// window); per window the most recent attributed event wins (a later "Not fed"
// correction overrides an earlier "Fed", mirroring latestFedByColony). Windows
// with no attributed event default to not-fed. Pure.
export function fedStateByWindow(
  windows: readonly AttribWindow[],
  events: readonly AttribEvent[],
): Map<string, WindowFedState> {
  const result = new Map<string, WindowFedState>();
  for (const w of windows) result.set(w.key, { fed: false, fedAt: null });
  if (windows.length === 0) return result;

  const ordered = windows
    .slice()
    .sort((a, b) => (a.startMinutes ?? 0) - (b.startMinutes ?? 0));

  const latest = new Map<string, AttribEvent>();
  for (const ev of events) {
    let target = ordered[0];
    for (const w of ordered) {
      if ((w.startMinutes ?? 0) <= ev.localMinutes) target = w;
      else break;
    }
    const prev = latest.get(target.key);
    if (
      !prev ||
      new Date(ev.observedAt).getTime() > new Date(prev.observedAt).getTime()
    ) {
      latest.set(target.key, ev);
    }
  }
  for (const [key, ev] of latest) {
    result.set(key, { fed: ev.fed, fedAt: ev.fed ? ev.observedAt : null });
  }
  return result;
}

// ── Per-window status for the display surfaces (Today + dashboard) ───────────
export type ColonyFeed = { observed_at: string; fed: boolean };
export type WindowStatus = {
  windowKey: string;
  start: string | null;
  end: string | null;
  status: FeedingStatus;
  fedAt: string | null;
};

// Compose ordering + attribution + the feedingStatus primitive into the
// per-window status list a colony renders. Uses the org timezone only to place
// the event in the local day; the missed threshold (minutes) is passed in.
export function colonyWindowStatuses(
  windows: readonly FeedingWindowRow[],
  feeds: readonly ColonyFeed[],
  tz: string,
  now: Date,
  missedAfterMin: number,
): WindowStatus[] {
  const ordered = orderWindows(windows);
  if (ordered.length === 0) return [];
  const events: AttribEvent[] = feeds.map((f) => ({
    localMinutes: localMinutesOfDay(new Date(f.observed_at), tz),
    observedAt: f.observed_at,
    fed: f.fed,
  }));
  const fedState = fedStateByWindow(
    ordered.map((w) => ({
      key: windowKeyOf(w),
      startMinutes: timeToMinutes(w.window_start),
    })),
    events,
  );
  return ordered.map((w) => {
    const key = windowKeyOf(w);
    const st = fedState.get(key) ?? { fed: false, fedAt: null };
    const minutesAfterClose = w.window_end
      ? minutesAfterWindow(w.window_end, tz, now)
      : null;
    return {
      windowKey: key,
      start: w.window_start,
      end: w.window_end,
      status: feedingStatus({ fed: st.fed, minutesAfterClose }, missedAfterMin),
      fedAt: st.fedAt,
    };
  });
}

// Worst-first rank for rolling per-window statuses up to a colony-level state
// (missed beats pending beats fed) — used for Today bucketing + the red rail.
const STATUS_RANK: Record<FeedingStatus, number> = {
  missed: 0,
  pending: 1,
  fed: 2,
};

export function overallWindowStatus(
  statuses: readonly FeedingStatus[],
): FeedingStatus {
  let worst: FeedingStatus = "fed";
  for (const s of statuses) {
    if (STATUS_RANK[s] < STATUS_RANK[worst]) worst = s;
  }
  return worst;
}
