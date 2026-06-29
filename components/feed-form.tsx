"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { enqueue } from "@/lib/offline/outbox";
import { getStore, isDefinitelyOffline } from "@/lib/offline/client";
import { ClockIcon, PawIcon, WarningIcon } from "@/components/icons";
import { hhmmToUtcIso, isHhmmFutureBeyondSkew, localHhmm } from "@/lib/time";
import { btnPrimary, input } from "@/lib/ui";

type Cat = {
  id: string;
  name: string | null;
  temp_id: string | null;
  photoSrc: string | null;
};

// Decorative 40px round avatar to the LEFT of the cat name. Reuses the colony-
// detail avatar markup; additive here are lazy loading + a row-local onError
// fallback to the paw, both inside a fixed h-10 w-10 box so there's no layout
// shift. The name remains the sole text label, so alt="" (decorative).
function CatAvatar({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-surface">
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <PawIcon className="h-5 w-5 text-muted" aria-hidden />
      )}
    </span>
  );
}

const sightingOptions = [
  {
    key: "seen",
    labelKey: "sightingSeen",
    on: "border-emerald-600 bg-emerald-600 text-white",
  },
  {
    key: "not_seen",
    labelKey: "sightingNotSeen",
    on: "border-amber-500 bg-amber-500 text-white",
  },
  {
    key: "concern",
    labelKey: "sightingConcern",
    on: "border-red-600 bg-red-600 text-white",
  },
] as const;

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
  const [sightings, setSightings] = useState<Record<string, string>>({});

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
      sightings: Object.entries(sightings)
        .filter(([, status]) => status)
        .map(([catId, status]) => ({
          id: crypto.randomUUID(),
          catId,
          status,
        })),
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
          <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
            {t("noCatsYet")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {cats.map((c) => {
              const sel = sightings[c.id] ?? "";
              return (
                <li
                  key={c.id}
                  className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3"
                >
                  <CatAvatar src={c.photoSrc} />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className="truncate text-sm font-medium">
                      {c.name ?? c.temp_id ?? t("unnamedCat")}
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
                            {t(s.labelKey)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
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
