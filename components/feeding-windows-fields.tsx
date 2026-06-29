"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { btnGhost, input } from "@/lib/ui";
import { MAX_FEEDING_WINDOWS } from "@/lib/feeding-windows";

type Row = { uid: number; start: string; end: string };

// Repeatable feeding-windows editor for the new + edit colony forms. Mirrors the
// add/remove-row idiom of schedules/schedule-fields.tsx: parallel repeated
// `window_start` / `window_end` hidden-by-name inputs the server action zips back
// with FormData.getAll. 0 windows is valid; the cap is 4 (Add disabled WITH a
// reason via aria-describedby). A half-filled pair is flagged inline (aria-invalid
// + note) — the server stays the trust gate and re-renders the page-level banner.
export function FeedingWindowsFields({
  initial,
}: {
  // Omitted = new colony (starts with one empty row). Provided (possibly empty)
  // = edit; an empty array renders the empty state (0 windows).
  initial?: { start: string; end: string }[];
}) {
  const t = useTranslations("colonies");

  const seed: Row[] =
    initial === undefined
      ? [{ uid: 0, start: "", end: "" }]
      : initial.map((w, i) => ({ uid: i, start: w.start, end: w.end }));
  const [rows, setRows] = useState<Row[]>(seed);
  const nextUid = useRef(seed.length);

  const startRefs = useRef(new Map<number, HTMLInputElement | null>());
  const removeRefs = useRef(new Map<number, HTMLButtonElement | null>());
  const addRef = useRef<HTMLButtonElement | null>(null);
  // Focus to apply AFTER the next render (the new/previous node must exist).
  const focusAfter = useRef<{
    type: "start" | "remove" | "add";
    uid?: number;
  } | null>(null);

  useEffect(() => {
    const f = focusAfter.current;
    if (!f) return;
    focusAfter.current = null;
    if (f.type === "start" && f.uid != null) {
      startRefs.current.get(f.uid)?.focus();
    } else if (f.type === "remove" && f.uid != null) {
      removeRefs.current.get(f.uid)?.focus();
    } else if (f.type === "add") {
      addRef.current?.focus();
    }
  }, [rows]);

  const atCap = rows.length >= MAX_FEEDING_WINDOWS;

  function addRow() {
    if (atCap) return;
    const uid = nextUid.current++;
    setRows((r) => [...r, { uid, start: "", end: "" }]);
    focusAfter.current = { type: "start", uid }; // announce the new row
  }

  function removeRow(uid: number) {
    const idx = rows.findIndex((r) => r.uid === uid);
    setRows((r) => r.filter((x) => x.uid !== uid));
    // Return focus to the previous row's Remove, or to Add if we removed the
    // first row — never let focus fall to <body>.
    focusAfter.current =
      idx > 0 ? { type: "remove", uid: rows[idx - 1].uid } : { type: "add" };
  }

  function update(uid: number, field: "start" | "end", value: string) {
    setRows((r) =>
      r.map((x) => (x.uid === uid ? { ...x, [field]: value } : x)),
    );
  }

  return (
    <div
      role="group"
      aria-labelledby="feeding-windows-legend"
      className="flex flex-col gap-2 rounded-xl border border-border bg-foreground/[0.02] p-3"
    >
      <span id="feeding-windows-legend" className="text-sm font-semibold">
        {t("feedingTimes")}
      </span>
      <p className="text-xs text-muted">{t("feedingTimesSub")}</p>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface px-3 py-3 text-center text-xs text-muted">
          {t("feedingWindowsEmpty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((row, i) => {
            const startMissing = !row.start && !!row.end;
            const endMissing = !!row.start && !row.end;
            const incomplete = startMissing || endMissing;
            return (
              <li
                key={row.uid}
                className={`rounded-lg border bg-surface p-2.5 ${
                  incomplete
                    ? "border-red-300 dark:border-red-900"
                    : "border-border"
                }`}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("feedingTimeN", { n: i + 1 })}
                  </span>
                  <button
                    type="button"
                    ref={(el) => {
                      removeRefs.current.set(row.uid, el);
                    }}
                    onClick={() => removeRow(row.uid)}
                    aria-label={t("removeFeedingTime", { n: i + 1 })}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border bg-surface text-red-700 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 dark:text-red-300 dark:hover:bg-red-950/40"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      aria-hidden
                      className="h-[18px] w-[18px]"
                    >
                      <path d="M6 6 18 18M18 6 6 18" />
                    </svg>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                    <span>{t("feedingFrom")}</span>
                    <input
                      type="time"
                      name="window_start"
                      value={row.start}
                      onChange={(e) => update(row.uid, "start", e.target.value)}
                      ref={(el) => {
                        startRefs.current.set(row.uid, el);
                      }}
                      aria-invalid={startMissing || undefined}
                      className={input}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                    <span>{t("feedingTo")}</span>
                    <input
                      type="time"
                      name="window_end"
                      value={row.end}
                      onChange={(e) => update(row.uid, "end", e.target.value)}
                      aria-invalid={endMissing || undefined}
                      className={input}
                    />
                  </label>
                </div>
                {incomplete ? (
                  <p className="mt-1.5 text-xs font-medium text-red-700 dark:text-red-300">
                    {t("feedingWindowRowNote")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        ref={addRef}
        onClick={addRow}
        disabled={atCap}
        aria-disabled={atCap || undefined}
        aria-describedby={atCap ? "feeding-windows-cap" : undefined}
        className={`${btnGhost} w-full text-sm`}
      >
        <span aria-hidden className="mr-1 text-base">
          +
        </span>
        {t("addFeedingTime")}
      </button>
      {atCap ? (
        <p id="feeding-windows-cap" className="text-xs text-muted">
          {t("feedingWindowsCap")}
        </p>
      ) : null}
    </div>
  );
}
