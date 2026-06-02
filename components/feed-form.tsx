"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { submitFeeding } from "@/app/app/colonies/actions";
import { btnPrimary, input } from "@/lib/ui";

type Cat = { id: string; name: string | null; temp_id: string | null };

const sightingOptions = [
  {
    key: "seen",
    label: "Seen",
    on: "border-emerald-600 bg-emerald-600 text-white",
  },
  {
    key: "not_seen",
    label: "Not seen",
    on: "border-amber-500 bg-amber-500 text-white",
  },
  {
    key: "concern",
    label: "Concern",
    on: "border-red-600 bg-red-600 text-white",
  },
] as const;

const colonyFlags = [
  { key: "problem", label: "Problem" },
  { key: "food_issue", label: "Food issue" },
  { key: "danger", label: "Danger" },
] as const;

export function FeedForm({
  colonyId,
  cats,
}: {
  colonyId: string;
  cats: Cat[];
}) {
  const [fed, setFed] = useState(true);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [sightings, setSightings] = useState<Record<string, string>>({});

  return (
    <form action={submitFeeding} className="flex flex-col gap-6">
      <input type="hidden" name="colony_id" value={colonyId} />
      <input type="hidden" name="fed" value={fed ? "1" : "0"} />
      {colonyFlags.map((f) => (
        <input
          key={f.key}
          type="hidden"
          name={f.key}
          value={flags[f.key] ? "1" : "0"}
        />
      ))}

      <section className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setFed((v) => !v)}
          aria-pressed={fed}
          className={`min-h-14 rounded-xl border text-base font-semibold transition ${
            fed
              ? "border-accent bg-accent text-accent-foreground"
              : "border-border text-foreground"
          }`}
        >
          {fed ? "✓ Fed" : "Mark as fed"}
        </button>
        <div className="grid grid-cols-3 gap-2">
          {colonyFlags.map((f) => {
            const on = !!flags[f.key];
            return (
              <button
                key={f.key}
                type="button"
                aria-pressed={on}
                onClick={() => setFlags((m) => ({ ...m, [f.key]: !m[f.key] }))}
                className={`min-h-12 rounded-lg border text-sm font-medium transition ${
                  on
                    ? "border-red-600 bg-red-600 text-white"
                    : "border-border text-foreground"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Cats
        </h2>
        {cats.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
            No cats in this colony yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {cats.map((c) => {
              const sel = sightings[c.id] ?? "";
              return (
                <li
                  key={c.id}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
                >
                  <input type="hidden" name={`cat:${c.id}`} value={sel} />
                  <span className="text-sm font-medium">
                    {c.name ?? c.temp_id ?? "Unnamed cat"}
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {sightingOptions.map((s) => {
                      const on = sel === s.key;
                      return (
                        <button
                          key={s.key}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setSightings((m) => ({
                              ...m,
                              [c.id]: m[c.id] === s.key ? "" : s.key,
                            }))
                          }
                          className={`min-h-11 rounded-lg border text-sm font-medium transition ${
                            on ? s.on : "border-border text-foreground"
                          }`}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        <span>Notes (optional)</span>
        <textarea name="notes" rows={2} className={`${input} py-2`} />
      </label>

      <SubmitButton
        pendingText="Saving…"
        className={`${btnPrimary} sticky bottom-4 min-h-13`}
      >
        Save update
      </SubmitButton>
    </form>
  );
}
