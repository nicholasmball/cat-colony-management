import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getLocale, getTranslations } from "next-intl/server";
import { getActiveOrg } from "@/lib/active-org";
import { photoSrc } from "@/lib/photo";
import { catLabel, formatStatus, statusTone } from "@/lib/cat-display";
import {
  UNCONFIRMED_STATUS,
  canReviewCat,
  attributionEmail,
} from "@/lib/cat-report";
import {
  concernCandidate,
  concernReasonKey,
  type ConcernSighting,
  type ConcernReview,
} from "@/lib/cat-concern";
import { PawIcon, WarningIcon } from "@/components/icons";
import { ConfirmButton } from "@/components/confirm-button";
import { SubmitButton } from "@/components/submit-button";
import { confirmCat, rejectCat } from "../report/actions";
import {
  ignoreConcern,
  monitorConcern,
  markCatMissing,
  markCatFound,
} from "../concern-actions";
import {
  btnGhost,
  btnGhostDanger,
  btnPrimary,
  card,
  fieldLabel,
  input,
} from "@/lib/ui";

// Relative-ish, locale-independent "when" for the report line. Keeps it simple:
// the date + time the report was created (records have no separate reporter
// column — see PR notes).
function reportedWhen(
  iso: string | null,
  displayLocale: string,
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(displayLocale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const toneClass: Record<string, string> = {
  good: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  warn: "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  bad: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  neutral: "bg-foreground/5 text-muted",
};

// Render a labelled fact only when it has a value — records accept incomplete
// data, so we never show empty rows or "unknown".
function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className={`${card} p-3`}>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

export default async function CatDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; catId: string }>;
  searchParams: Promise<{
    error?: string;
    ignored?: string;
    monitoring?: string;
    missing?: string;
    found?: string;
  }>;
}) {
  const { id, catId } = await params;
  const { error, ignored, monitoring, missing, found } = await searchParams;
  const t = await getTranslations("cats");
  const tc = await getTranslations("common");
  const tConcern = await getTranslations();
  const locale = await getLocale();
  const displayLocale = locale === "pt" ? "pt-PT" : "en-GB";
  const concernText = (flag: {
    reason: "concern" | "not_seen_days" | "repeated_not_seen";
    count: number;
  }) => tConcern(concernReasonKey(flag.reason), { count: flag.count });
  const org = await getActiveOrg();
  const supabase = await createClient();

  const { data: cat } = await supabase
    .from("cats")
    .select(
      "id, name, temp_id, colour, markings, sex, neutered, approx_age, status, notes, photo_url, created_at, reported_by, confirmed_by, confirmed_at",
    )
    .eq("id", catId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cat) notFound();

  // Breadcrumb back to the colony by name (falls back to a generic label).
  const { data: colony } = await supabase
    .from("colonies")
    .select("name")
    .eq("id", id)
    .maybeSingle();

  const photo = await photoSrc(
    cat.photo_url as string | null,
    org?.organisation_id ?? "",
  );
  const canManage = org?.role === "admin" || org?.role === "caretaker";
  const unconfirmed = cat.status === UNCONFIRMED_STATUS;
  // Confirm/Reject show only for a manager AND only while the cat is still
  // awaiting review — gated in the UI here and re-checked in the server action.
  const canReview = canManage && canReviewCat(cat);
  const when = reportedWhen(cat.created_at as string | null, displayLocale);
  const label = catLabel(cat);

  // ── Concern review block ───────────────────────────────────────────────────
  // Bounded fetch (this one cat's recent sightings + reviews + the org's
  // thresholds), then the pure concernCandidate() helper. The block shows for an
  // active flagged cat OR a missing cat (to offer the approved Mark-found
  // reversal). Feeders see the context line but no actions. Never auto-anything.
  const status = cat.status as string;
  let concernFlag: ReturnType<typeof concernCandidate> = null;
  let monitoringSince: string | null = null;
  if (org && (status === "active" || status === "missing")) {
    const [{ data: sightingData }, { data: reviewData }, { data: settings }] =
      await Promise.all([
        supabase
          .from("cat_sightings")
          .select("status, observed_at")
          .eq("cat_id", catId)
          .order("observed_at", { ascending: false })
          .limit(100),
        supabase
          .from("cat_concern_reviews")
          .select("outcome, created_at")
          .eq("cat_id", catId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("alert_settings")
          .select("not_seen_days, repeated_not_seen")
          .eq("organisation_id", org.organisation_id)
          .maybeSingle(),
      ]);
    const sightings = (sightingData ?? []).map((s) => ({
      status: s.status as ConcernSighting["status"],
      observed_at: s.observed_at as string,
    }));
    const reviews = (reviewData ?? []).map((r) => ({
      outcome: r.outcome as ConcernReview["outcome"],
      created_at: r.created_at as string,
    }));
    concernFlag = concernCandidate({
      status,
      sightings,
      reviews,
      thresholds: {
        not_seen_days: (settings?.not_seen_days as number | null) ?? null,
        repeated_not_seen:
          (settings?.repeated_not_seen as number | null) ?? null,
      },
      now: new Date(),
    });
    if (concernFlag?.monitoring && reviews[0]?.outcome === "monitoring") {
      monitoringSince = reviews[0].created_at;
    }
  }
  const isMissing = status === "missing";
  const isActiveFlagged = status === "active" && concernFlag !== null;

  // Resolve the reporter / confirmer emails server-side. One service-client
  // lookup per DISTINCT id (≤2 here) — no N+1. Mirrors the incident detail
  // pattern (incidents/[incidentId]/page.tsx). The cat page has no service
  // client otherwise; it's added solely for this attribution lookup.
  const reportedBy = cat.reported_by as string | null;
  const confirmedBy = cat.confirmed_by as string | null;
  const emails = new Map<string, string>();
  const userIds = new Set<string>(
    [reportedBy, confirmedBy].filter((v): v is string => !!v),
  );
  if (userIds.size > 0) {
    const svc = createServiceClient();
    await Promise.all(
      [...userIds].map(async (uid) => {
        const { data } = await svc.auth.admin.getUserById(uid);
        // Only record a real email — a missing/deleted account leaves the id
        // unmapped so attributionEmail() degrades to a clean time-only line.
        if (data.user?.email) emails.set(uid, data.user.email);
      }),
    );
  }
  const reporterEmail = attributionEmail(reportedBy, emails);
  const confirmerEmail = attributionEmail(confirmedBy, emails);

  // Same Intl.DateTimeFormat (org timezone) used on the incident page. Falls
  // back to UTC if there's no active org so a render never throws.
  const dateTimeFmt = new Intl.DateTimeFormat(displayLocale, {
    timeZone: org?.timezone ?? "UTC",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  // ONE timestamp for the report event: reuse the cat's created_at (the same
  // source reportedWhen() uses) so we never show two different times for the
  // same event. Formatted via the org-timezone formatter for the attribution
  // line; the existing review note keeps using `when`.
  const reportedAt = cat.created_at as string | null;
  const neuteredText = (v: boolean) =>
    v ? t("neutered_yes") : t("neutered_no");
  const sex =
    cat.sex && cat.neutered != null
      ? `${cat.sex} · ${neuteredText(cat.neutered as boolean)}`
      : cat.sex
        ? (cat.sex as string)
        : cat.neutered != null
          ? neuteredText(cat.neutered as boolean)
          : null;

  return (
    <div className="flex max-w-3xl flex-col gap-6 px-6 py-6 md:px-10">
      <Link href={`/app/colonies/${id}`} className="text-sm text-accent">
        {"← "}
        {colony?.name ?? tc("colony")}
      </Link>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      {ignored || monitoring || missing || found ? (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
        >
          {ignored ? t("toastReviewed") : null}
          {monitoring ? t("toastMonitoring") : null}
          {missing ? t("toastMissing") : null}
          {found ? t("toastFound") : null}
        </p>
      ) : null}

      <div className="grid gap-6 md:grid-cols-[260px_1fr] md:items-start">
        {/* Photo (or paw fallback) */}
        <div className="grid aspect-square w-full max-w-[260px] place-items-center overflow-hidden rounded-2xl border border-border bg-surface">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt={t("photoOfAlt", { label })}
              className="h-full w-full object-cover"
            />
          ) : (
            <PawIcon className="h-16 w-16 text-muted" />
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-3xl">{label}</h1>
              <span
                className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  unconfirmed ? "" : "capitalize"
                } ${toneClass[statusTone(cat.status)]}`}
              >
                {unconfirmed ? "★ " : ""}
                {unconfirmed
                  ? t("status.newUnconfirmed")
                  : formatStatus(cat.status)}
              </span>
            </div>
            {canManage ? (
              <Link
                href={`/app/colonies/${id}/cats/${catId}/edit`}
                className={`${btnGhost} text-sm`}
              >
                {tc("edit")}
              </Link>
            ) : null}
          </div>

          {/* Attribution lines — who reported / confirmed this cat. Plain muted
              text, all roles see it (no role gate). overflow-wrap:anywhere +
              title handle long emails at 375px without orphaning the timestamp.
              Time-only null degrade: when there's no reporter email we show
              "Reported {when}" with NO name and never the literal "unknown"
              (this intentionally differs from the incident page's "unknown"
              fallback — keep it clean). One consistent report timestamp:
              reportedAt is the cat's created_at, the same source `when` uses. */}
          {reportedAt ? (
            <p className="text-xs text-muted [overflow-wrap:anywhere]">
              {reporterEmail ? (
                <>
                  {t("reportedByLine")}{" "}
                  <span title={reporterEmail}>{reporterEmail}</span> ·{" "}
                </>
              ) : (
                <>{t("reportedLine")} </>
              )}
              {dateTimeFmt.format(new Date(reportedAt))}
            </p>
          ) : null}
          {confirmerEmail && cat.confirmed_at ? (
            <p className="text-xs text-muted [overflow-wrap:anywhere]">
              {t("confirmedByLine")}{" "}
              <span title={confirmerEmail}>{confirmerEmail}</span> ·{" "}
              {dateTimeFmt.format(new Date(cat.confirmed_at as string))}
            </p>
          ) : null}

          {/* Review context line for a reported cat. We don't store a reporter
              column (no migration), so we surface the time it was reported and
              set the right expectation by role. */}
          {unconfirmed ? (
            <p role="note" className={`${card} px-3 py-2 text-sm text-muted`}>
              {when ? t("reportedWhen", { when }) : ""}
              {canReview ? t("reviewConfirmHint") : t("reviewWaitHint")}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <Fact label={t("factColour")} value={cat.colour} />
            <Fact label={t("factMarkings")} value={cat.markings} />
            <Fact label={t("factSex")} value={sex} />
            <Fact label={t("factApproxAge")} value={cat.approx_age} />
          </div>
          {cat.notes ? (
            <div className={`${card} p-3`}>
              <p className="text-xs uppercase tracking-wide text-muted">
                {t("notesLabel")}
              </p>
              <p className="whitespace-pre-wrap text-sm">{cat.notes}</p>
            </div>
          ) : null}

          {/* Confirm / Reject — caretaker/admin only, and only while the cat is
              still awaiting review (canReview). The server action re-checks both
              role and the new_unconfirmed status. Confirm is the primary action;
              Reject is ghost-danger and opens a destructive confirm dialog. */}
          {canReview ? (
            <div className="flex gap-2">
              <form action={confirmCat} className="flex-1">
                <input type="hidden" name="colony_id" value={id} />
                <input type="hidden" name="cat_id" value={catId} />
                <SubmitButton
                  pendingText={t("confirming")}
                  className={`${btnPrimary} w-full min-h-12`}
                >
                  {t("confirmCat")}
                </SubmitButton>
              </form>
              <form action={rejectCat} className="flex-1">
                <input type="hidden" name="colony_id" value={id} />
                <input type="hidden" name="cat_id" value={catId} />
                <ConfirmButton
                  confirm={t("rejectConfirm")}
                  confirmLabel={t("rejectLabel")}
                  className={`${btnGhostDanger} w-full min-h-12`}
                >
                  {t("rejectEllipsis")}
                </ConfirmButton>
              </form>
            </div>
          ) : null}

          {/* Concern review block. Caretaker/admin act here; feeders see the
              same context line (the reason / monitoring / missing state) with no
              actions. The server actions re-check role + status guards, so this
              UI gate is convenience, never the trust boundary. */}
          {isActiveFlagged ? (
            <div
              className={`${card} flex flex-col gap-3 border-l-4 border-l-amber-400 p-4`}
            >
              <p className="flex items-center gap-2 text-sm font-medium">
                <WarningIcon
                  className="h-5 w-5 shrink-0 text-amber-500"
                  aria-hidden
                />
                {concernText(concernFlag!)}
                {concernFlag!.monitoring ? (
                  <span className="text-xs font-normal text-muted">
                    {monitoringSince
                      ? t("monitoringSince", {
                          date: dateTimeFmt.format(new Date(monitoringSince)),
                        })
                      : t("monitoringLabel")}
                  </span>
                ) : null}
              </p>
              {canManage ? (
                <>
                  {/* Monitor + Ignore share one form so the optional note posts
                      with whichever the caretaker picks (formAction selects the
                      server action). Mark-missing is a separate destructive form
                      with a confirm dialog and no note. */}
                  <form className="flex flex-col gap-3">
                    <input type="hidden" name="colony_id" value={id} />
                    <input type="hidden" name="cat_id" value={catId} />
                    <label className={`${fieldLabel} text-xs`}>
                      {t("noteOptional")}
                      <textarea
                        name="note"
                        rows={2}
                        className={`${input} py-2`}
                        placeholder={t("notePlaceholder")}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        formAction={monitorConcern}
                        className={`${btnPrimary} min-h-11 px-4`}
                      >
                        {t("monitor")}
                      </button>
                      <button
                        type="submit"
                        formAction={ignoreConcern}
                        className={`${btnGhost} min-h-11 px-4`}
                      >
                        {t("ignore")}
                      </button>
                    </div>
                  </form>
                  <form action={markCatMissing}>
                    <input type="hidden" name="colony_id" value={id} />
                    <input type="hidden" name="cat_id" value={catId} />
                    <ConfirmButton
                      confirm={t("markMissingConfirm")}
                      confirmLabel={t("markMissingLabel")}
                      className={`${btnGhostDanger} min-h-11 px-4`}
                    >
                      {t("markMissing")}
                    </ConfirmButton>
                  </form>
                </>
              ) : (
                <p className="text-xs text-muted">{t("caretakerWillReview")}</p>
              )}
            </div>
          ) : null}

          {/* Missing cat → offer the approved Mark-found reversal. */}
          {isMissing && canManage ? (
            <div className={`${card} flex flex-col gap-3 p-4`}>
              <p className="text-sm text-muted">{t("missingHint")}</p>
              <form action={markCatFound}>
                <input type="hidden" name="colony_id" value={id} />
                <input type="hidden" name="cat_id" value={catId} />
                <ConfirmButton
                  confirm={t("markFoundConfirm")}
                  confirmLabel={t("markFoundLabel")}
                  className={`${btnPrimary} min-h-11 px-4`}
                >
                  {t("markFound")}
                </ConfirmButton>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
