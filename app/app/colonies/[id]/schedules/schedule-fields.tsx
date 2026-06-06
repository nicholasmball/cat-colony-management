"use client";

import { useState } from "react";
import { WEEKDAY_TOGGLES } from "@/lib/schedule";
import { fieldLabel, input } from "@/lib/ui";

type ScheduleType = "weekly" | "one_off";

// Type toggle (Weekly / One-off) + the matching control (weekday multi-select
// OR a date input). Only one control renders, so the form is never half-filled.
// New schedules only — editing a row keeps its existing weekday/date.
export function ScheduleFields({
  defaultType = "weekly",
  defaultDate = "",
}: {
  defaultType?: ScheduleType;
  defaultDate?: string;
}) {
  const [type, setType] = useState<ScheduleType>(defaultType);
  const [days, setDays] = useState<Set<number>>(new Set());

  function toggleDay(weekday: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(weekday)) next.delete(weekday);
      else next.add(weekday);
      return next;
    });
  }

  const segBase =
    "min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition";
  const segOn = "bg-accent text-accent-foreground";
  const segOff = "text-muted hover:bg-foreground/5";

  return (
    <div className="flex flex-col gap-2">
      <span className={fieldLabel}>
        <span>Type</span>
      </span>
      <div
        role="group"
        aria-label="Schedule type"
        className="flex gap-1 rounded-lg border border-border p-1"
      >
        <button
          type="button"
          aria-pressed={type === "weekly"}
          onClick={() => setType("weekly")}
          className={`${segBase} ${type === "weekly" ? segOn : segOff}`}
        >
          ⟳ Weekly
        </button>
        <button
          type="button"
          aria-pressed={type === "one_off"}
          onClick={() => setType("one_off")}
          className={`${segBase} ${type === "one_off" ? segOn : segOff}`}
        >
          ★ One-off
        </button>
      </div>
      {/* Server action reads this to branch weekly vs one-off. */}
      <input type="hidden" name="type" value={type} />

      {type === "weekly" ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <span id="weekday-label" className="text-sm font-medium">
            Repeats on
          </span>
          <div
            role="group"
            aria-labelledby="weekday-label"
            className="flex gap-1.5"
          >
            {WEEKDAY_TOGGLES.map((d) => {
              const on = days.has(d.weekday);
              return (
                <button
                  key={d.weekday}
                  type="button"
                  aria-pressed={on}
                  aria-label={d.short}
                  onClick={() => toggleDay(d.weekday)}
                  className={`grid h-11 min-w-0 flex-1 place-items-center rounded-lg border text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 ${
                    on
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border bg-surface text-muted hover:bg-foreground/5"
                  }`}
                >
                  {d.letter}
                </button>
              );
            })}
          </div>
          {/* One hidden input per selected day → repeated "weekday" fields. */}
          {[...days].map((w) => (
            <input key={w} type="hidden" name="weekday" value={w} />
          ))}
        </div>
      ) : (
        <label className={`${fieldLabel} mt-2`}>
          <span>Date</span>
          <input
            type="date"
            name="specific_date"
            defaultValue={defaultDate}
            className={input}
          />
        </label>
      )}
    </div>
  );
}
