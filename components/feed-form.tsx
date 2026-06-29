"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { enqueue } from "@/lib/offline/outbox";
import { getStore, isDefinitelyOffline } from "@/lib/offline/client";
import { ClockIcon, FlagIcon, PawIcon, WarningIcon } from "@/components/icons";
import { hhmmToUtcIso, isHhmmFutureBeyondSkew, localHhmm } from "@/lib/time";
import { buildSightings, countSightings } from "@/lib/feed-sightings";
import { btnPrimary, input } from "@/lib/ui";

type Cat = {
  id: string;
  name: string | null;
  temp_id: string | null;
  photoSrc: string | null;
};

// Square, full-width tile photo for the tap-to-mark-seen grid. Lazy-loaded with
// a tile-local onError fallback to the paw, inside a fixed aspect-square box so
// photos arriving later cause no layout shift (key for a 30+ cat colony). The
// name is always the text label, so alt="" (decorative). `dimmed` lifts the
// "not seen" tiles' photos so an un-tapped cat reads as "not marked yet" —
// reinforced by the glyph + word chip, never colour/opacity alone.
function TilePhoto({
  src,
  dimmed,
  children,
}: {
  src: string | null;
  dimmed: boolean;
  children: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="relative block aspect-square w-full overflow-hidden bg-foreground/5">
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className={`h-full w-full object-cover transition ${
            dimmed ? "opacity-60 saturate-[.85]" : ""
          }`}
        />
      ) : (
        <span className="grid h-full w-full place-items-center">
          <PawIcon className="h-8 w-8 text-muted" aria-hidden />
        </span>
      )}
      {children}
    </span>
  );
}

const colonyFlags = [
  { key: "problem", labelKey: "flagProblem" },
  { key: "food_issue", labelKey: "flagFoodIssue" },
  { key: "danger", labelKey: "flagDanger" },
] as const;

export function FeedForm({
  colonyId,
  cats,
  timezone,
}: {
  colonyId: string;
  cats: Cat[];
  timezone: string;
}) {
  const t = useTranslations("feed");
  const router = useRouter();
  const [fed, setFed] = useState(true);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  // Tap-to-mark-seen grid state. `seen` and `concern` are id sets the feeder
  // builds by tapping; `wholeColony` (default ON) decides whether un-tapped cats
  // are written not_seen (full round) or omitted (partial round). The seen and
  // concern sets are independent: a flagged tile keeps its underlying seen state,
  // so clearing the flag returns it to seen/not-seen with no data lost. The pure
  // mapper (lib/feed-sightings.ts buildSightings) turns these into sightings[].
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const [concern, setConcern] = useState<ReadonlySet<string>>(() => new Set());
  const [wholeColony, setWholeColony] = useState(true);

  function toggleSeen(id: string) {
    setSeen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleConcern(id: string) {
    setConcern((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const counts = countSightings(cats, { seen, concern });

  // Optional "Time fed" control. It surfaces + lets the feeder adjust the
  // observedAt the form already mints at tap — pre-filled to NOW in the org
  // timezone. The pre-fill happens AFTER mount (not in the initial render) so the
  // server-rendered markup and the client agree on the input value — a dynamic
  // "now" baked into SSR would otherwise trip a hydration mismatch. The default
  // is held in a ref (the as-loaded value), so an "Edited" cue only shows on a
  // real user change — a native picker re-emitting the same HH:MM on load reads
  // as unchanged.
  const [timeFed, setTimeFed] = useState("");
  const [defaultTime, setDefaultTime] = useState("");
  const timeInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Set off the synchronous effect body via a microtask (mirroring useOnline in
    // sync-indicator.tsx) to avoid a cascading-render warning; the empty initial
    // value already covers the pre-mount window and falls back to now() on submit.
    queueMicrotask(() => {
      const hhmm = localHhmm(new Date(), timezone);
      setDefaultTime(hhmm);
      setTimeFed(hhmm);
    });
  }, [timezone]);

  const validTime = /^\d{2}:\d{2}$/.test(timeFed);
  const edited = validTime && timeFed !== defaultTime;
  const now = new Date();
  const nowHhmm = localHhmm(now, timezone);
  // Only an EXPLICIT future beyond the shared skew window is an error; the field
  // at rest (≈ now) and any earlier time are fine. The server still coerces a
  // stray future value as the backstop — we just spare the feeder the surprise.
  const futureError = edited && isHhmmFutureBeyondSkew(timeFed, timezone, now);
  // Replaces useFormStatus (which only works inside a server-action <form>): we
  // now drive the disabled/pending state ourselves around the fetch, preserving
  // the exact same "can't double-submit" behaviour the SubmitButton gave.
  const [submitting, setSubmitting] = useState(false);
  // Inline error mirrors the feed page's server-rendered ?error= banner: same
  // copy source (localized) + same alert styling, shown without a round-trip.
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    // Never truly blocked: we only hold the submit while the TYPED time is an
    // explicit future (beyond skew). The feeder fixes it in place — there's a
    // one-tap "reset to now" affordance — then Save works. The Save button
    // reflects this via aria-disabled (not opacity-alone).
    if (futureError) {
      timeInputRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError(null);

    // The field-observation time the route applies to the feeding event AND every
    // sighting. Captured NOW (at the tap, before the offline/online branch) so a
    // queued offline write keeps its true field time after syncing later. If the
    // feeder adjusted the optional "Time fed" control, use that HH:MM interpreted
    // as today in the org timezone instead; an untouched/cleared control falls
    // back to exact-now, so the zero-interaction case is identical to before.
    const observedAt =
      edited && validTime
        ? hhmmToUtcIso(timeFed, timezone, new Date())
        : new Date().toISOString();

    // Phase 1 transport: mint a client UUID for the feeding event and one per
    // marked cat sighting, then POST JSON to the route. The client UUIDs make a
    // replay idempotent (Phase 2's offline outbox relies on this); the route
    // upserts onConflict:"id". Only cats the feeder actually marked are sent.
    const body = {
      id: crypto.randomUUID(),
      colonyId,
      observedAt,
      fed,
      problem: !!flags.problem,
      foodIssue: !!flags.food_issue,
      danger: !!flags.danger,
      notes:
        (
          e.currentTarget.elements.namedItem("notes") as HTMLTextAreaElement
        )?.value?.trim() || null,
      // The grid's seen/concern sets + the whole-colony checkbox collapse to the
      // SAME sightings[] shape the route already accepts (status ∈
      // seen|not_seen|concern). buildSightings owns the precedence (concern >
      // seen > not_seen-if-wholeColony > omit); we just mint a client UUID per
      // entry for idempotent replay, exactly as before.
      sightings: buildSightings(cats, { seen, concern, wholeColony }).map(
        (s) => ({
          id: crypto.randomUUID(),
          catId: s.catId,
          status: s.status,
        }),
      ),
    };

    const destination = `/app/colonies/${colonyId}?updated=1`;

    // Phase 2 offline-first: if the browser KNOWS it's offline, skip the network
    // and queue immediately. The client UUID makes the later replay idempotent.
    if (isDefinitelyOffline()) {
      if (await queueOffline(body)) {
        router.push(destination);
        router.refresh();
        return;
      }
      setError(t("submitFailed"));
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/feedings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        // A real server rejection (validation/auth) surfaces as before — NOT
        // queued, since a blind replay wouldn't fix it.
        setError(json.error || t("submitFailed"));
        setSubmitting(false);
        return;
      }
      // Same destination the server action redirected to.
      router.push(destination);
      router.refresh();
    } catch {
      // The fetch threw → a network failure mid-submit. Queue + proceed as if it
      // succeeded; the outbox flush will replay it on reconnect.
      if (await queueOffline(body)) {
        router.push(destination);
        router.refresh();
        return;
      }
      setError(t("submitFailed"));
      setSubmitting(false);
    }
  }

  // Enqueue the feeding write to the offline outbox. Returns false only if there
  // is no queue available (no IndexedDB) or the write itself failed — in which
  // case the caller surfaces the generic submit error rather than silently
  // dropping the update.
  async function queueOffline(body: unknown): Promise<boolean> {
    const store = getStore();
    if (!store) return false;
    try {
      await enqueue(store, {
        localId: (body as { id: string }).id,
        kind: "feeding",
        url: "/api/feedings",
        body,
        createdAt: Date.now(),
      });
      return true;
    } catch {
      return false;
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <h2
            id="fed-label"
            className="text-xs font-semibold uppercase tracking-wide text-muted"
          >
            {t("wasColonyFed")}
          </h2>
          <div
            role="radiogroup"
            aria-labelledby="fed-label"
            className="grid grid-cols-2 gap-2"
          >
            {/* Single-select: exactly one of Fed / Not fed is always chosen.
                Fed-on reuses the "Seen" sighting's emerald on-class so the form
                reads as one family; "Not fed" uses a neutral-strong fill
                (foreground/background) — selected but not success-green. */}
            <button
              type="button"
              role="radio"
              aria-checked={fed}
              onClick={() => setFed(true)}
              className={`min-h-12 rounded-lg border text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 ${
                fed
                  ? "border-emerald-600 bg-emerald-600 font-semibold text-white"
                  : "border-border font-medium text-foreground"
              }`}
            >
              {t("fed")}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!fed}
              onClick={() => setFed(false)}
              className={`min-h-12 rounded-lg border text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 ${
                !fed
                  ? "border-foreground bg-foreground font-semibold text-background"
                  : "border-border font-medium text-foreground"
              }`}
            >
              {t("notFed")}
            </button>
          </div>
        </div>
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
                {t(f.labelKey)}
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t("cats")}
        </h2>
        {cats.length === 0 ? (
          // Empty colony stays useful: fed / flags / notes still submit (cat
          // records never block). The friendly note carries that explicitly.
          <p className="flex items-start gap-2.5 rounded-xl border border-border bg-surface p-4 text-sm text-muted">
            <PawIcon
              className="mt-0.5 h-5 w-5 shrink-0 text-muted"
              aria-hidden
            />
            <span>{t("noCatsYet")}</span>
          </p>
        ) : (
          <>
            {/* Legend makes the INVERTED default explicit in TEXT (never colour-
                alone): un-tapped = not seen. It rewrites for the partial round so
                the rule is always honest about what Save will write. */}
            <div
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                wholeColony
                  ? "border-emerald-600/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                  : "border-accent/40 bg-accent/5 text-foreground"
              }`}
            >
              <span aria-hidden className="mt-px shrink-0">
                {wholeColony ? "👁" : "◐"}
              </span>
              <span>
                {wholeColony ? t("gridLegend") : t("gridLegendPartial")}{" "}
                {t("gridLegendFlagHint")}
              </span>
            </div>

            {/* Live count — the feeder's last-chance check before Save. The
                problem count lives INSIDE the polite region so it's announced
                too; the not-seen count EXCLUDES concern tiles. */}
            <p
              aria-live="polite"
              className="text-sm font-semibold tabular-nums text-foreground"
            >
              {t("countSeen", { seen: counts.seen, total: cats.length })}
              <span className="font-medium text-muted">
                {" · "}
                {t("countNotSeen", { count: counts.notSeen })}
                {counts.problem > 0
                  ? ` · ${t("countProblem", { count: counts.problem })}`
                  : ""}
              </span>
            </p>

            <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {cats.map((c) => {
                const catLabel = c.name ?? c.temp_id ?? t("unnamedCat");
                const isConcern = concern.has(c.id);
                const isSeen = seen.has(c.id);
                // aria-pressed on the main button tracks the underlying SEEN
                // toggle (so tapping always flips seen ↔ not-seen, even under a
                // flag); the visible state shows concern's override. Full state-
                // aware label on every tile regardless of colony size.
                const stateWord = isConcern
                  ? t("tileStateProblem")
                  : isSeen
                    ? t("sightingSeen")
                    : t("sightingNotSeen");
                const nextWord = isSeen
                  ? t("sightingNotSeen")
                  : t("sightingSeen");
                return (
                  <li key={c.id} className="relative">
                    <button
                      type="button"
                      aria-pressed={isSeen}
                      aria-label={t("tileTapLabel", {
                        cat: catLabel,
                        state: stateWord,
                        next: nextWord,
                      })}
                      onClick={() => toggleSeen(c.id)}
                      className={`block w-full overflow-hidden rounded-xl border-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                        isConcern
                          ? "border-amber-500 bg-amber-50 dark:bg-amber-950/40"
                          : isSeen
                            ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40"
                            : "border-border bg-surface"
                      }`}
                    >
                      <TilePhoto
                        src={c.photoSrc}
                        dimmed={!isSeen && !isConcern}
                      >
                        <span
                          className={`absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${
                            isConcern
                              ? "border-amber-500 bg-amber-500 text-amber-950"
                              : isSeen
                                ? "border-emerald-600 bg-emerald-600 text-white"
                                : "border-border bg-surface/90 text-muted"
                          }`}
                        >
                          <span aria-hidden>
                            {isConcern ? "⚑" : isSeen ? "✓" : "○"}
                          </span>
                          {stateWord}
                        </span>
                      </TilePhoto>
                      <span className="block truncate px-2 py-2 text-sm font-semibold text-foreground">
                        {catLabel}
                      </span>
                    </button>
                    {/* SEPARATE ≥44px control — a sibling, NOT nested in the main
                        button. Marks concern (overrides seen/not-seen) and clears
                        back to the prior state. */}
                    <button
                      type="button"
                      aria-pressed={isConcern}
                      aria-label={
                        isConcern
                          ? t("problemReportedFor", { cat: catLabel })
                          : t("reportProblemWith", { cat: catLabel })
                      }
                      onClick={() => toggleConcern(c.id)}
                      className="absolute right-0 top-0 z-10 grid h-11 w-11 place-items-center focus-visible:outline-none"
                    >
                      <span
                        aria-hidden
                        className={`grid h-7 w-7 place-items-center rounded-lg border text-sm transition ${
                          isConcern
                            ? "border-amber-500 bg-amber-500 text-amber-950"
                            : "border-border bg-surface/90 text-muted"
                        }`}
                      >
                        <FlagIcon className="h-4 w-4" aria-hidden />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        <span>{t("notesOptional")}</span>
        <textarea name="notes" rows={2} className={`${input} py-2`} />
      </label>

      {/* Optional "Time fed" — a quiet secondary strip just above Save. Pre-filled
          to now; the common case is zero interaction. */}
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface/60 p-3">
        <div className="flex items-center gap-3">
          <label
            htmlFor="time-fed"
            className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium"
          >
            <ClockIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            <span>
              {t("timeFed")}{" "}
              <span className="font-medium text-muted">
                {t("timeFedOptional")}
              </span>
            </span>
          </label>
          <input
            id="time-fed"
            ref={timeInputRef}
            type="time"
            value={timeFed}
            onChange={(e) => setTimeFed(e.target.value)}
            aria-invalid={futureError || undefined}
            aria-describedby={futureError ? "time-fed-error" : "time-fed-hint"}
            className={`min-h-11 min-w-[7rem] rounded-lg border bg-surface px-3 text-center tabular-nums text-foreground focus:outline-none focus:ring-2 ${
              futureError
                ? "border-red-600 focus:ring-red-600/25"
                : "border-border focus:border-accent focus:ring-accent/25"
            }`}
          />
        </div>

        {edited && !futureError ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 font-semibold text-accent">
              {t("timeFedEdited")}
            </span>
            <span className="text-muted">
              {t("timeFedNowIs", { time: nowHhmm })}
            </span>
          </div>
        ) : null}

        {futureError ? (
          <>
            <p
              id="time-fed-error"
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:bg-red-950/60 dark:text-red-300"
            >
              <WarningIcon
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                aria-hidden
              />
              <span>{t("timeFedFutureError", { time: nowHhmm })}</span>
            </p>
            <button
              type="button"
              onClick={() => setTimeFed(localHhmm(new Date(), timezone))}
              className="self-start text-xs font-semibold text-accent underline underline-offset-2"
            >
              {t("timeFedReset")}
            </button>
          </>
        ) : (
          <p id="time-fed-hint" className="text-xs text-muted">
            {t("timeFedHint")}
          </p>
        )}
      </div>

      {/* "I checked the whole colony" — default ON, sits right above Save. ON →
          un-tapped cats are written not_seen (full round); OFF → un-tapped cats
          are omitted (partial round), so a feeder who only did part of the round
          never mass-marks cats not-seen. The helper text + count reflect exactly
          what Save will write. Only meaningful with cats present. */}
      {cats.length > 0 ? (
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
            wholeColony
              ? "border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/40"
              : "border-accent/40 bg-accent/5"
          }`}
        >
          <input
            type="checkbox"
            checked={wholeColony}
            onChange={(e) => setWholeColony(e.target.checked)}
            className="mt-0.5 h-6 w-6 shrink-0 accent-emerald-600"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-bold text-foreground">
              {t("wholeColonyCheck")}
            </span>
            <span
              className={`text-xs font-medium ${
                wholeColony
                  ? "text-emerald-900 dark:text-emerald-200"
                  : "text-accent"
              }`}
            >
              {wholeColony
                ? t("wholeColonyHelperOn", { count: counts.notSeen })
                : t("wholeColonyHelperOff", { count: counts.seen })}
            </span>
          </span>
        </label>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting}
        aria-disabled={submitting || futureError}
        className={`${btnPrimary} sticky bottom-4 min-h-13 disabled:cursor-not-allowed disabled:opacity-60 ${
          futureError ? "cursor-not-allowed opacity-60" : ""
        }`}
      >
        {submitting ? t("savingUpdate") : t("saveUpdate")}
      </button>
    </form>
  );
}
