import { incidentStatusLabel } from "@/lib/incident";
import { WarningIcon } from "@/components/icons";

// Status + urgency pills for incidents — the exact "icon + word, never colour
// alone" (WCAG 1.4.1) convention from app/app/today/page.tsx's StatusGlyph.
// Open = neutral grey ●, In progress = amber ◐, Resolved = emerald ✓. Urgency
// is a SEPARATE red ⚠ badge so an urgent item reads unmistakably independent of
// its status. Shared by the triage list, the detail header and the per-colony
// section so the three views stay identical.

// 'closed' (DB enum) collapses to the resolved tone (one terminal "Resolved").
type StatusKey = "open" | "in_progress" | "resolved" | "closed";

const statusTone: Record<StatusKey, string> = {
  open: "bg-foreground/5 text-muted",
  in_progress:
    "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  resolved:
    "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  closed:
    "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
};

function StatusGlyph({ status }: { status: StatusKey }) {
  if (status === "resolved" || status === "closed") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="h-3.5 w-3.5"
      >
        <path d="m5 12.5 4.5 4.5L19 7" />
      </svg>
    );
  }
  if (status === "in_progress") {
    // Half-filled circle — the "◐ in progress" glyph from the design.
    return (
      <svg viewBox="0 0 24 24" aria-hidden className="h-3 w-3">
        <circle
          cx="12"
          cy="12"
          r="8"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
        />
        <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
      </svg>
    );
  }
  // open → solid dot.
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className="h-2.5 w-2.5"
    >
      <circle cx="12" cy="12" r="6" />
    </svg>
  );
}

export function IncidentStatusPill({ status }: { status: string }) {
  const key = (["open", "in_progress", "resolved", "closed"] as const).includes(
    status as StatusKey,
  )
    ? (status as StatusKey)
    : "open";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusTone[key]}`}
    >
      <StatusGlyph status={key} />
      {incidentStatusLabel(status)}
    </span>
  );
}

// Red urgency badge, shown only when the incident's urgency level alerts
// immediately. Icon + word, never colour alone.
export function UrgentBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300">
      <WarningIcon className="h-3 w-3" aria-hidden />
      Urgent
    </span>
  );
}
