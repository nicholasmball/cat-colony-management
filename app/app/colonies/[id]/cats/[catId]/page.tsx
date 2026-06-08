import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveOrg } from "@/lib/active-org";
import { photoSrc } from "@/lib/photo";
import { catLabel, formatStatus, statusTone } from "@/lib/cat-display";
import {
  UNCONFIRMED_STATUS,
  canReviewCat,
  attributionEmail,
} from "@/lib/cat-report";
import { PawIcon } from "@/components/icons";
import { ConfirmButton } from "@/components/confirm-button";
import { SubmitButton } from "@/components/submit-button";
import { confirmCat, rejectCat } from "../report/actions";
import { btnGhost, btnGhostDanger, btnPrimary, card } from "@/lib/ui";

// Relative-ish, locale-independent "when" for the report line. Keeps it simple:
// the date + time the report was created (records have no separate reporter
// column — see PR notes).
function reportedWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-GB", {
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
  searchParams: Promise<{ error?: string }>;
}) {
  const { id, catId } = await params;
  const { error } = await searchParams;
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
  const when = reportedWhen(cat.created_at as string | null);
  const label = catLabel(cat);

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
  const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
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
  const sex =
    cat.sex && cat.neutered != null
      ? `${cat.sex} · ${cat.neutered ? "neutered" : "not neutered"}`
      : cat.sex
        ? cat.sex
        : cat.neutered != null
          ? cat.neutered
            ? "neutered"
            : "not neutered"
          : null;

  return (
    <div className="flex max-w-3xl flex-col gap-6 px-6 py-6 md:px-10">
      <Link href={`/app/colonies/${id}`} className="text-sm text-accent">
        ← {colony?.name ?? "Colony"}
      </Link>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 md:grid-cols-[260px_1fr] md:items-start">
        {/* Photo (or paw fallback) */}
        <div className="grid aspect-square w-full max-w-[260px] place-items-center overflow-hidden rounded-2xl border border-border bg-surface">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt={`Photo of ${label}`}
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
                {formatStatus(cat.status)}
              </span>
            </div>
            {canManage ? (
              <Link
                href={`/app/colonies/${id}/cats/${catId}/edit`}
                className={`${btnGhost} text-sm`}
              >
                Edit
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
                  Reported by <span title={reporterEmail}>{reporterEmail}</span>{" "}
                  ·{" "}
                </>
              ) : (
                <>Reported </>
              )}
              {dateTimeFmt.format(new Date(reportedAt))}
            </p>
          ) : null}
          {confirmerEmail && cat.confirmed_at ? (
            <p className="text-xs text-muted [overflow-wrap:anywhere]">
              Confirmed by <span title={confirmerEmail}>{confirmerEmail}</span>{" "}
              · {dateTimeFmt.format(new Date(cat.confirmed_at as string))}
            </p>
          ) : null}

          {/* Review context line for a reported cat. We don't store a reporter
              column (no migration), so we surface the time it was reported and
              set the right expectation by role. */}
          {unconfirmed ? (
            <p role="note" className={`${card} px-3 py-2 text-sm text-muted`}>
              {when ? `Reported ${when}. ` : ""}
              {canReview
                ? "Confirm to add it to the colony, or reject if it’s a duplicate or mistake."
                : "Waiting for a caretaker to review."}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <Fact label="Colour" value={cat.colour} />
            <Fact label="Markings" value={cat.markings} />
            <Fact label="Sex" value={sex} />
            <Fact label="Approx. age" value={cat.approx_age} />
          </div>
          {cat.notes ? (
            <div className={`${card} p-3`}>
              <p className="text-xs uppercase tracking-wide text-muted">
                Notes
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
                  pendingText="Confirming…"
                  className={`${btnPrimary} w-full min-h-12`}
                >
                  Confirm cat
                </SubmitButton>
              </form>
              <form action={rejectCat} className="flex-1">
                <input type="hidden" name="colony_id" value={id} />
                <input type="hidden" name="cat_id" value={catId} />
                <ConfirmButton
                  confirm="Reject this reported cat? It will be removed from the colony. You can’t undo this."
                  confirmLabel="Reject"
                  className={`${btnGhostDanger} w-full min-h-12`}
                >
                  Reject…
                </ConfirmButton>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
