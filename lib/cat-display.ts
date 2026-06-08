// Pure, presentation-agnostic helpers for rendering a cat in lists and on the
// detail page. Kept free of React/Tailwind so they're trivially unit-testable
// and shared between the colony list and the cat detail page.

export type CatStatusTone = "good" | "warn" | "bad" | "neutral";

// A cat may have only a description (temp_id) and no name — never show a blank.
export function catLabel(cat: {
  name?: string | null;
  temp_id?: string | null;
}): string {
  return cat.name?.trim() || cat.temp_id?.trim() || "Unnamed cat";
}

// Friendly, human-facing labels for statuses whose raw enum reads badly. The
// stored value is unchanged — this is display-only. "new_unconfirmed" would
// otherwise render as "new unconfirmed"; we show "New · unconfirmed" so the
// chip reads as a clear review state (used in the cats list + cat detail).
const STATUS_LABEL: Record<string, string> = {
  new_unconfirmed: "New · unconfirmed",
};

// "not_seen" -> "not seen". Uses a friendly label where one exists, else falls
// back to de-underscoring the raw enum. Display-only; the stored value is
// unchanged.
export function formatStatus(status: string): string {
  return STATUS_LABEL[status] ?? status.replace(/_/g, " ").trim();
}

// Map a status to a colour tone. Covers both the cat's base status (active /
// missing / …) and sighting-derived values (seen / not_seen / concern) so the
// same helper works once the status-history card lands.
export function statusTone(status: string): CatStatusTone {
  switch (status) {
    case "active":
    case "seen":
      return "good";
    case "concern":
      return "warn";
    case "missing":
    case "not_seen":
      return "bad";
    default:
      return "neutral";
  }
}

// One-line subtitle for a list row: "ginger · seen", dropping empty parts so a
// colour-less or status-less cat never renders stray separators.
export function catSubtitle(cat: {
  colour?: string | null;
  status?: string | null;
}): string {
  return [cat.colour?.trim(), cat.status ? formatStatus(cat.status) : null]
    .filter(Boolean)
    .join(" · ");
}
