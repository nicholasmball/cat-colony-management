// Pure request-shaping + validation for the feeding JSON route handler
// (app/api/feedings/route.ts). NO Supabase / Next imports so the rules are
// unit-testable without a DB. The route does authn/authz + the DB upsert; this
// layer turns an untrusted JSON body into a typed, validated payload (or a field
// error), mirroring submitFeeding in app/app/colonies/actions.ts.
//
// The "30-second feeding update" north star is preserved exactly: one feeding
// event + N cat sightings. The only transport change is that every row carries a
// CLIENT-SUPPLIED UUID (for idempotent replay), so the ids are validated here.

import { isUuid } from "./uuid.ts";

// The cat_sighting statuses the form's per-cat segmented control can emit. Same
// three the feed form offers (components/feed-form.tsx sightingOptions). A
// sighting the feeder left untouched is simply omitted client-side and must not
// appear in the body.
export const SIGHTING_STATUSES = ["seen", "not_seen", "concern"] as const;
export type SightingStatus = (typeof SIGHTING_STATUSES)[number];

export function isSightingStatus(value: unknown): value is SightingStatus {
  return (
    typeof value === "string" &&
    (SIGHTING_STATUSES as readonly string[]).includes(value)
  );
}

export type FeedingSightingInput = {
  id: string;
  catId: string;
  status: SightingStatus;
};

export type FeedingInput = {
  id: string;
  colonyId: string;
  fed: boolean;
  problem: boolean;
  foodIssue: boolean;
  danger: boolean;
  notes: string | null;
  sightings: FeedingSightingInput[];
};

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function asBool(v: unknown): boolean {
  // Accept a real boolean (JSON) or the legacy "1"/"0" string the form used to
  // send via FormData, so the contract is forgiving but never coerces garbage.
  return v === true || v === "1";
}

function asTrimmedOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

// Validate a parsed JSON body into a typed FeedingInput. Required: a well-formed
// client UUID `id`, a `colonyId` (validated as a UUID — it's a row id), and, for
// every sighting, a well-formed UUID `id` + UUID `catId` + a valid status enum.
// Everything else is optional flags/notes (the form never blocks on them).
export function parseFeedingInput(body: unknown): ParseResult<FeedingInput> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body." };
  }
  const b = body as Record<string, unknown>;

  if (!isUuid(b.id)) {
    return { ok: false, error: "A valid feeding id is required." };
  }
  if (!isUuid(b.colonyId)) {
    return { ok: false, error: "A valid colony id is required." };
  }

  const rawSightings = b.sightings;
  if (rawSightings !== undefined && !Array.isArray(rawSightings)) {
    return { ok: false, error: "Sightings must be a list." };
  }
  const sightings: FeedingSightingInput[] = [];
  for (const raw of (rawSightings as unknown[]) ?? []) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: "Each sighting must be an object." };
    }
    const s = raw as Record<string, unknown>;
    if (!isUuid(s.id)) {
      return { ok: false, error: "A valid sighting id is required." };
    }
    if (!isUuid(s.catId)) {
      return { ok: false, error: "A valid cat id is required." };
    }
    if (!isSightingStatus(s.status)) {
      return { ok: false, error: "Invalid sighting status." };
    }
    sightings.push({ id: s.id, catId: s.catId, status: s.status });
  }

  return {
    ok: true,
    value: {
      id: b.id,
      colonyId: b.colonyId,
      fed: asBool(b.fed),
      problem: asBool(b.problem),
      foodIssue: asBool(b.foodIssue),
      danger: asBool(b.danger),
      notes: asTrimmedOrNull(b.notes),
      sightings,
    },
  };
}
