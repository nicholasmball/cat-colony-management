// Batched, org-scoped reads of colony feeding windows (the colony_feeding_windows
// table, migration 0013). One query for many colonies — the list/Today/dashboard
// pages and the cron sweep each read every colony they display in a SINGLE round
// trip, then group + order in memory (no N+1). The pure ordering/attribution
// lives in lib/feeding-windows.ts; this module only does the I/O.

import type { SupabaseClient } from "@supabase/supabase-js";
import { orderWindows, type FeedingWindowRow } from "@/lib/feeding-windows";

type WindowSelectRow = {
  id: string;
  colony_id: string;
  window_start: string | null;
  window_end: string | null;
  position: number;
};

// colony_id → its windows, ordered (position, then start). Colonies with no
// windows are simply absent from the map (callers default to an empty list).
// `orgId` is an extra defence-in-depth scope on the RLS-bound client; omit it
// for the service-role cron sweep, which is already constrained by colonyIds.
export async function getWindowsByColony(
  client: SupabaseClient,
  colonyIds: readonly string[],
  orgId?: string,
): Promise<Map<string, FeedingWindowRow[]>> {
  const byColony = new Map<string, FeedingWindowRow[]>();
  if (colonyIds.length === 0) return byColony;

  let query = client
    .from("colony_feeding_windows")
    .select("id, colony_id, window_start, window_end, position")
    .in("colony_id", colonyIds as string[]);
  if (orgId) query = query.eq("organisation_id", orgId);

  const { data } = await query;
  for (const r of (data ?? []) as WindowSelectRow[]) {
    const list = byColony.get(r.colony_id) ?? [];
    list.push({
      id: r.id,
      window_start: r.window_start,
      window_end: r.window_end,
      position: r.position,
    });
    byColony.set(r.colony_id, list);
  }
  for (const [id, list] of byColony) byColony.set(id, orderWindows(list));
  return byColony;
}
