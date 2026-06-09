// Pure request-shaping + validation for the incident JSON route handler
// (app/api/incidents/route.ts). NO Supabase / Next imports. Mirrors
// createIncident in app/app/colonies/[id]/incidents/actions.ts: `type` is the
// ONLY required field (validated against the real enum); urgency is resolved/
// defaulted server-side against the org's lookup, an optional cat is
// re-validated server-side, everything else is optional. The transport change
// is a CLIENT-SUPPLIED UUID `id` for the incident row (idempotent replay).

import { isUuid } from "./uuid.ts";
import { parseFieldTimestamp } from "./field-time.ts";
import { isValidIncidentType, type IncidentType } from "../incident.ts";
import type { ParseResult } from "./feeding-input.ts";

export type IncidentInput = {
  id: string;
  colonyId: string;
  type: IncidentType;
  // Optional submitted urgency id — the route honours it ONLY if it's really one
  // of the org's levels, else defaults; either way it shapes to a string|null
  // here and the route resolves it against incident_urgency_levels.
  urgencyLevelId: string | null;
  // Optional cat — the route re-validates it belongs to this colony+org before
  // attaching; a stale/foreign id is dropped to null there. We only shape it.
  catId: string | null;
  notes: string | null;
  photoKey: string | null;
  photoFailed: boolean;
  // Client-captured field time (ISO) for when the incident actually occurred.
  // undefined → the route omits the column and Postgres stamps occurred_at with
  // now() (pre-fix behaviour / old queued items). Present → the route writes it
  // so an offline-reported incident keeps its true field time after syncing.
  occurredAt: string | undefined;
};

function asTrimmedOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export function parseIncidentInput(body: unknown): ParseResult<IncidentInput> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body." };
  }
  const b = body as Record<string, unknown>;

  if (!isUuid(b.id)) {
    return { ok: false, error: "A valid incident id is required." };
  }
  if (!isUuid(b.colonyId)) {
    return { ok: false, error: "A valid colony id is required." };
  }
  // Type is the only truly required field — validate against the real enum so a
  // bad value never reaches Postgres (mirrors the action).
  if (!isValidIncidentType(b.type)) {
    return { ok: false, error: "Choose what's happening before you report." };
  }

  return {
    ok: true,
    value: {
      id: b.id,
      colonyId: b.colonyId,
      type: b.type,
      urgencyLevelId: asTrimmedOrNull(b.urgencyLevelId),
      catId: asTrimmedOrNull(b.catId),
      notes: asTrimmedOrNull(b.notes),
      photoKey: asTrimmedOrNull(b.photoKey),
      photoFailed: b.photoFailed === true || b.photoFailed === "1",
      occurredAt: parseFieldTimestamp(b.occurredAt),
    },
  };
}
