// Pure request-shaping + validation for the cat-report JSON route handler
// (app/api/cats/report/route.ts). NO Supabase / Next imports. Mirrors reportCat
// in app/app/colonies/[id]/cats/report/actions.ts: at least one identifier
// (name OR description) is required; everything else is optional and never
// blocks the report. The only transport change is a CLIENT-SUPPLIED UUID `id`
// for the new cat row (idempotent replay), validated here.

import { isUuid } from "./uuid.ts";
import { hasReportIdentifier, parseNeutered } from "../cat-report.ts";
import type { ParseResult } from "./feeding-input.ts";

export type CatReportInput = {
  id: string;
  colonyId: string;
  name: string | null;
  tempId: string | null;
  colour: string | null;
  // Sex is a free-ish string today ("male"/"female"/null) — the form maps its
  // "unknown" tri-state to "" which we normalise to null. Kept as the action has
  // it (no enum guard there) so behaviour is identical.
  sex: string | null;
  neutered: boolean | null;
  notes: string | null;
  // The presigned R2 key, if a photo was attached online. The route still does
  // the isKeyInOrg org-scope guard (it needs the org id); this layer only shapes
  // it. photoFailed mirrors the form's non-blocking "photo=failed" contract.
  photoKey: string | null;
  photoFailed: boolean;
};

function asTrimmedOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export function parseCatReportInput(
  body: unknown,
): ParseResult<CatReportInput> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body." };
  }
  const b = body as Record<string, unknown>;

  if (!isUuid(b.id)) {
    return { ok: false, error: "A valid cat id is required." };
  }
  if (!isUuid(b.colonyId)) {
    return { ok: false, error: "A valid colony id is required." };
  }

  const name = asTrimmedOrNull(b.name);
  const tempId = asTrimmedOrNull(b.tempId);
  // Same rule as the action + the cats_need_identifier CHECK: name OR temp_id.
  if (!hasReportIdentifier({ name, temp_id: tempId })) {
    return {
      ok: false,
      error: "Add a name or a short description so the cat can be identified.",
    };
  }

  return {
    ok: true,
    value: {
      id: b.id,
      colonyId: b.colonyId,
      name,
      tempId,
      colour: asTrimmedOrNull(b.colour),
      sex: asTrimmedOrNull(b.sex),
      // Tri-state: "yes"/"no"/anything-else → true/false/null (unknown stays
      // null — records accept incomplete data). Same parseNeutered the action
      // and the edit form share.
      neutered: parseNeutered(
        typeof b.neutered === "string" ? b.neutered : undefined,
      ),
      notes: asTrimmedOrNull(b.notes),
      photoKey: asTrimmedOrNull(b.photoKey),
      photoFailed: b.photoFailed === true || b.photoFailed === "1",
    },
  };
}
