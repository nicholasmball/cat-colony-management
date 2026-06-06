// Pure schedule matching — does a feeding_schedules row apply to "today"?
//
// "Today" is supplied as the org-LOCAL date + weekday (computed via lib/time's
// todayInTz in the org timezone), so this stays a pure, tz-agnostic comparison.

export type ScheduleMatchInput = {
  weekday: number | null;
  specific_date: string | null;
  is_active: boolean;
  deleted_at: string | null;
};

export type TodayInput = {
  localDate: string; // "YYYY-MM-DD" in the org's zone
  weekday: number; // 0=Sun..6=Sat, matching the org-local date
};

// True iff the schedule is live and either its one-off date is today or its
// recurring weekday matches today's weekday.
export function scheduleMatchesToday(
  schedule: ScheduleMatchInput,
  today: TodayInput,
): boolean {
  if (!schedule.is_active || schedule.deleted_at) return false;
  return (
    schedule.specific_date === today.localDate ||
    schedule.weekday === today.weekday
  );
}

// 0=Sun..6=Sat for a "YYYY-MM-DD" date. Anchored at UTC midnight so it's a pure
// function of the calendar date — never shifted by the host's local offset/DST.
export function localWeekday(localDate: string): number {
  return new Date(localDate + "T00:00:00Z").getUTCDay();
}

// Short weekday names indexed 0=Sun..6=Sat, matching the DB `weekday` column.
export const WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

// Single-letter toggle captions in calendar order (Mon-first for the picker).
export const WEEKDAY_TOGGLES = [
  { weekday: 1, short: "Mon", letter: "M" },
  { weekday: 2, short: "Tue", letter: "T" },
  { weekday: 3, short: "Wed", letter: "W" },
  { weekday: 4, short: "Thu", letter: "T" },
  { weekday: 5, short: "Fri", letter: "F" },
  { weekday: 6, short: "Sat", letter: "S" },
  { weekday: 0, short: "Sun", letter: "S" },
] as const;

// Human "when" for a row: "Sat 14 Jun" for a one-off, "Mon" for a weekly day.
export function scheduleWhen(schedule: {
  weekday: number | null;
  specific_date: string | null;
}): string {
  if (schedule.specific_date) {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(schedule.specific_date + "T00:00:00Z"));
  }
  if (schedule.weekday != null) return WEEKDAY_LABELS[schedule.weekday];
  return "—";
}
