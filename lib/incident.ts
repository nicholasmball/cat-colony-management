// Pure incident helpers — no Supabase / Next imports so they're unit-testable
// without a live DB. The DB enum + per-org urgency lookup are the source of
// truth; these just validate/select against what the caller already loaded.

// The fixed `public.incident_type` enum (supabase/migrations/0002_domain.sql
// lines 16-18). The type is NOT user-editable — picking one of these is the
// only truly required field on the report form.
export const INCIDENT_TYPES = [
  "sick_injured",
  "new_cat",
  "missing_concern",
  "dead_cat",
  "poisoning",
  "threat_person",
  "dog_danger",
  "access_problem",
  "other",
] as const;

export type IncidentType = (typeof INCIDENT_TYPES)[number];

// Enum membership guard — narrows an untrusted form value to a real enum
// member so the action never sends a bad string to Postgres.
export function isValidIncidentType(value: unknown): value is IncidentType {
  return (
    typeof value === "string" &&
    (INCIDENT_TYPES as readonly string[]).includes(value)
  );
}

// Human-readable label per incident type. Same wording as the report form's
// tiles (components/incident-form.tsx TYPE_LABEL) so the type reads identically
// on the form, the triage list and the detail page. Kept here (pure) so list/
// detail server components don't have to import the client form.
const TYPE_LABEL: Record<IncidentType, string> = {
  poisoning: "Poisoning",
  sick_injured: "Sick / injured",
  dog_danger: "Dog danger",
  threat_person: "Threat from person",
  new_cat: "New cat",
  missing_concern: "Missing concern",
  dead_cat: "Dead cat",
  access_problem: "Feeding / access",
  other: "Other",
};

// Humanise a (trusted, DB-sourced) incident type. Falls back to the raw value
// rather than throwing, so an enum added in a future migration still renders.
export function incidentTypeLabel(type: string): string {
  return TYPE_LABEL[type as IncidentType] ?? type;
}

// Human-readable label per UI lifecycle status. The DB enum also has 'closed'
// (0002_domain.sql:19-20); it's collapsed into the terminal "Resolved" so it
// reads sensibly if a legacy/closed row ever surfaces.
const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Resolved",
};

export function incidentStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

// One per-org urgency level (a row of public.incident_urgency_levels).
export type UrgencyLevel = {
  id: string;
  key: string;
  label: string;
  sort_order: number;
  alerts_immediately: boolean;
};

// The default urgency when the reporter doesn't choose one: the org's
// "not-urgent" baseline. Preference order:
//   1. the lowest-sort level that does NOT alert immediately (the seeded
//      `not_urgent` row, sort_order 1, alerts_immediately false);
//   2. failing that (an org with only urgent levels), the lowest-sort level;
//   3. null when the list is empty.
// urgency_level_id on incidents is nullable, but the approved "alert seam"
// requires it to be NON-NULL on insert, so the action treats a null return as
// a hard configuration error rather than silently inserting null.
export function defaultUrgencyLevel(
  levels: readonly UrgencyLevel[],
): UrgencyLevel | null {
  if (levels.length === 0) return null;
  const bySort = (a: UrgencyLevel, b: UrgencyLevel) =>
    a.sort_order - b.sort_order;
  const calm = levels.filter((l) => !l.alerts_immediately).sort(bySort);
  if (calm.length > 0) return calm[0];
  return [...levels].sort(bySort)[0];
}
