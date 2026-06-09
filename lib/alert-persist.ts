// The single write path for the alert engine: turn the pure planner's
// AlertSpec[] (lib/alert-engine.ts) into one notifications row PER recipient and
// insert them idempotently. SERVER-ONLY (it takes a service-role client, which
// bypasses RLS for the cross-org / system fan-out). Shared by BOTH the cron
// sweep and the three event hooks so the row shape, the channel-intent stamping
// and the ON CONFLICT DO NOTHING idempotency live in exactly one place.
//
// Records intent only — it NEVER sends a push/SMS/email and never touches
// dispatched_at (left NULL on insert; a later channel card stamps it). The
// recipient set is resolved by the caller (lib/alert-recipients.alertRecipients
// over the org's memberships); this just fans each spec across those ids.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertSpec } from "./alert-engine.ts";
import { channelsFor } from "./alert-routing.ts";

// Build the flat notifications rows for one org: spec × recipient. Pure so the
// row shaping (typed FKs, message_key/params, channel intent, dedup key) is
// unit-tested without a DB. dispatched_at is deliberately never set here.
export function buildAlertRows(
  organisationId: string,
  specs: readonly AlertSpec[],
  recipientIds: readonly string[],
): Record<string, unknown>[] {
  if (specs.length === 0 || recipientIds.length === 0) return [];
  const rows: Record<string, unknown>[] = [];
  for (const spec of specs) {
    const channels = channelsFor(spec.severity);
    for (const recipientId of recipientIds) {
      rows.push({
        organisation_id: organisationId,
        recipient_id: recipientId,
        type: spec.type,
        severity: spec.severity,
        message_key: spec.message_key,
        message_params: spec.message_params,
        colony_id: spec.colony_id ?? null,
        cat_id: spec.cat_id ?? null,
        incident_id: spec.incident_id ?? null,
        channels,
        // The singular legacy `channel` (0002) stays at its default; the engine
        // reads `channels`. dispatched_at is intentionally omitted → NULL.
        dedup_key: spec.dedup_key,
      });
    }
  }
  return rows;
}

// Insert the fanned rows with ON CONFLICT (recipient_id, dedup_key) DO NOTHING
// (the unique index from 0009), so a cron re-scan or a double event is a no-op,
// never a duplicate alert. Returns the number of rows actually inserted.
// Caller owns the try/catch for the non-blocking event-hook case.
export async function persistAlerts(
  svc: SupabaseClient,
  organisationId: string,
  specs: readonly AlertSpec[],
  recipientIds: readonly string[],
): Promise<number> {
  const rows = buildAlertRows(organisationId, specs, recipientIds);
  if (rows.length === 0) return 0;
  const { data, error } = await svc
    .from("notifications")
    .upsert(rows, {
      onConflict: "recipient_id,dedup_key",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}
