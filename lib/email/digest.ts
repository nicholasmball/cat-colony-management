// Pure selection logic for the daily-digest cron — the "who gets which routine
// alerts in their digest" rule, kept side-effect-free so it is node:test-able
// without a DB (mirrors lib/alert-recipients + lib/alert-engine's pure-core
// shape). The cron route (app/api/cron/email-digest) does the I/O: read
// notifications, call selectDigests, render + send per recipient, then stamp
// dispatched_at on the rows a successful send covered.
//
// What belongs in a digest (all must hold):
//   * UNDISPATCHED — dispatched_at is null (a stamped row already went out).
//   * EMAIL channel — `channels` includes "email" (routine alerts route to
//     in_app+email per lib/alert-routing; urgent push/SMS rows are excluded).
//   * grouped PER recipient, with the row ids so the route can stamp exactly the
//     rows it sent and leave a failed/skipped send's rows for the next run.
//   * deduped by notification id (a defensive guard against a row appearing
//     twice in the input set).

export type DigestRow = {
  id: string;
  recipient_id: string;
  organisation_id: string;
  type: string;
  message_params: Record<string, unknown>;
  channels: string[] | null;
  dispatched_at: string | null;
};

export type DigestItem = {
  id: string;
  type: string;
  message_params: Record<string, unknown>;
};

export type DigestPayload = {
  recipientId: string;
  organisationId: string;
  // The notification row ids this digest covers — the route stamps exactly
  // these as dispatched once a (non-skipped) send succeeds.
  rowIds: string[];
  // The items to render, newest first preserved from the caller's ordering.
  items: DigestItem[];
};

function eligible(row: DigestRow): boolean {
  if (row.dispatched_at != null) return false;
  return (row.channels ?? []).includes("email");
}

// Group undispatched, email-channel rows per recipient (one payload each). A
// recipient who is in two orgs gets one payload PER org (keyed recipient:org)
// so a digest never mixes colonies across organisations. Input order is
// preserved within each payload; duplicate ids are dropped.
export function selectDigests(
  rows: readonly DigestRow[],
): Map<string, DigestPayload> {
  const byKey = new Map<string, DigestPayload>();
  const seenIds = new Set<string>();

  for (const row of rows) {
    if (!eligible(row)) continue;
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);

    const key = `${row.recipient_id}:${row.organisation_id}`;
    const payload = byKey.get(key) ?? {
      recipientId: row.recipient_id,
      organisationId: row.organisation_id,
      rowIds: [],
      items: [],
    };
    payload.rowIds.push(row.id);
    payload.items.push({
      id: row.id,
      type: row.type,
      message_params: row.message_params ?? {},
    });
    byKey.set(key, payload);
  }

  return byKey;
}
