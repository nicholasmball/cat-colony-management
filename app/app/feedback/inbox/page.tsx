import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActiveOrg } from "@/lib/active-org";
import { createServiceClient } from "@/lib/supabase/service";
import { photoSrc } from "@/lib/photo";
import { relativeTime } from "@/lib/relative-time";
import {
  feedbackStatusBadge,
  shortAppVersion,
  isInAppPath,
} from "@/lib/feedback-inbox";
import { card } from "@/lib/ui";
import { MegaphoneIcon } from "@/components/icons";
import { FeedbackResolveForm } from "@/components/feedback-resolve-form";

// Cap the read — the inbox is a UAT triage surface, not an archive. 200 is well
// above any realistic single-org test volume and keeps the page bounded.
const FEEDBACK_LIMIT = 200;

type FeedbackRow = {
  id: string;
  kind: string;
  message: string;
  reporter_role: string | null;
  page_url: string | null;
  locale: string | null;
  app_version: string | null;
  screenshot_key: string | null;
  status: string;
  created_at: string;
  // Resolve fields (0012, pending application). Inline-typed so the page
  // compiles regardless of the live schema; the columns are all nullable.
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
};

// Admin-only, read-only inbox of the active org's feedback (newest-first).
//
// READ PATH (D-1): the table's RLS only lets a member read THEIR OWN rows, so an
// admin couldn't see the team's submissions through the RLS client. We therefore
// read via the service-role client — but ONLY after the same admin gate the
// Members/Org pages use, and ALWAYS scoped to `organisation_id = active org`, so
// no migration/policy change is needed and nothing leaks across orgs. The
// service key is server-only (createServiceClient throws in the browser).
export default async function FeedbackInboxPage() {
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  if (org.role !== "admin") redirect("/app"); // admin-only screen (same as Members)

  const t = await getTranslations("feedback");
  const locale = await getLocale();

  // Caller is verified admin → service-role read, hard-scoped to this org.
  const svc = createServiceClient();
  const { data } = await svc
    .from("feedback")
    .select(
      "id, kind, message, reporter_role, page_url, locale, app_version, screenshot_key, status, created_at, resolved_at, resolved_by, resolution_note",
    )
    .eq("organisation_id", org.organisation_id)
    .order("created_at", { ascending: false })
    .limit(FEEDBACK_LIMIT);

  const rows = (data ?? []) as FeedbackRow[];

  // Resolve each resolver's display name (their email, the only personal data we
  // hold — same source the Members page uses). Batched over the DISTINCT ids of
  // the visible resolved rows so it's one lookup per resolver, never N+1.
  const resolverNames = new Map<string, string>();
  const resolverIds = [
    ...new Set(
      rows
        .filter((r) => r.status === "resolved" && r.resolved_by)
        .map((r) => r.resolved_by as string),
    ),
  ];
  await Promise.all(
    resolverIds.map(async (id) => {
      const { data: u } = await svc.auth.admin.getUserById(id);
      resolverNames.set(
        id,
        u.user?.email ?? t("inbox.resolve.resolvedByFallback"),
      );
    }),
  );

  // Presign each present screenshot key in parallel. photoSrc returns null when
  // storage is unconfigured OR the presign fails — both degrade to the
  // "unavailable" chip; a null/empty key renders no image affordance at all.
  const shots = new Map<string, string | null>();
  await Promise.all(
    rows
      .filter((r) => r.screenshot_key)
      .map(async (r) => {
        shots.set(r.id, await photoSrc(r.screenshot_key, org.organisation_id));
      }),
  );

  const now = new Date();

  const roleLabelKey: Record<string, string> = {
    admin: "inbox.roleAdmin",
    caretaker: "inbox.roleCaretaker",
    feeder: "inbox.roleFeeder",
  };
  const statusClass: Record<"new" | "queued" | "resolved" | "neutral", string> =
    {
      new: "bg-accent/10 text-accent border-accent/20",
      queued:
        "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900",
      // Resolved is a distinct, TERMINAL state: slate (not green) + a ✓ glyph.
      resolved:
        "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700",
      neutral: "bg-foreground/5 text-muted border-border",
    };
  // Known-status badge → its i18n leaf. Record<string,…> tolerates the neutral
  // variant (which carries its own raw label and never indexes this map).
  const statusLabelKey: Record<string, string> = {
    new: "inbox.statusNew",
    queued: "inbox.statusQueued",
    resolved: "inbox.statusResolved",
  };

  return (
    <div className="flex max-w-2xl flex-col gap-5 px-6 py-6 md:px-10">
      <header className="flex flex-col gap-2">
        <Link
          href="/app/feedback"
          aria-label={t("inbox.backAria")}
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m15 6-6 6 6 6" />
          </svg>
          {t("inbox.back")}
        </Link>
        <h1 className="font-display text-3xl">{t("inbox.title")}</h1>
        <p className="text-sm text-muted">{t("inbox.intro")}</p>
      </header>

      {rows.length === 0 ? (
        <div
          className={`${card} flex flex-col items-center gap-2 px-6 py-10 text-center`}
        >
          <span
            aria-hidden="true"
            className="mb-1 grid h-14 w-14 place-items-center rounded-full bg-accent/10 text-accent"
          >
            <MegaphoneIcon width={26} height={26} />
          </span>
          <h2 className="font-display text-xl">{t("inbox.emptyTitle")}</h2>
          <p className="max-w-[30ch] text-sm text-muted">
            {t("inbox.emptyBody")}
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t("inbox.count", { count: rows.length })}
          </p>

          <ul className="flex flex-col gap-3">
            {rows.map((row) => {
              const isBug = row.kind === "bug";
              const badge = feedbackStatusBadge(row.status);
              const statusLabel =
                badge.label ?? t(statusLabelKey[badge.variant]);
              const isResolved = badge.variant === "resolved";
              const resolverName = row.resolved_by
                ? (resolverNames.get(row.resolved_by) ??
                  t("inbox.resolve.resolvedByFallback"))
                : t("inbox.resolve.resolvedByFallback");
              const roleKey = roleLabelKey[row.reporter_role ?? ""];
              const roleLabel = roleKey
                ? t(roleKey)
                : (row.reporter_role ?? "—");
              const build = shortAppVersion(row.app_version);
              const created = new Date(row.created_at);

              const hasKey = !!row.screenshot_key;
              const shotUrl = shots.get(row.id) ?? null;

              return (
                <li key={row.id} className={`${card} px-4 py-3.5`}>
                  {/* Header: kind (glyph + word) · status · relative time */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                        isBug
                          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
                          : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
                      }`}
                    >
                      <span aria-hidden="true">{isBug ? "🐞" : "💡"}</span>
                      {t(isBug ? "kindBug" : "kindIdea")}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusClass[badge.variant]}`}
                    >
                      {isResolved ? (
                        <span
                          aria-hidden="true"
                          className="text-[0.7rem] leading-none font-bold"
                        >
                          ✓
                        </span>
                      ) : (
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-full bg-current"
                        />
                      )}
                      {statusLabel}
                    </span>
                    <time
                      dateTime={row.created_at}
                      title={created.toLocaleString(locale)}
                      className="ml-auto whitespace-nowrap text-xs text-muted"
                    >
                      {relativeTime(created, now, locale)}
                    </time>
                  </div>

                  {/* Message — full, pre-wrapped, never truncated */}
                  <p className="mt-2.5 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {row.message}
                  </p>

                  {/* Screenshot: present+signed → enlarge-in-place; present but
                      unsigned → "unavailable" chip; absent → nothing. */}
                  {hasKey && shotUrl ? (
                    <details className="mt-3 group">
                      <summary className="inline-flex cursor-pointer list-none items-center gap-2.5 rounded-lg border border-border bg-surface p-2 text-sm [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={shotUrl}
                          alt={t("inbox.screenshotAlt")}
                          className="h-12 w-12 rounded-md border border-border object-cover group-open:hidden"
                        />
                        <span className="flex flex-col">
                          <b className="font-semibold">
                            {t("inbox.screenshotTitle")}
                          </b>
                          <span className="font-medium text-accent">
                            {t("inbox.screenshotEnlarge")}
                          </span>
                        </span>
                      </summary>
                      <div className="mt-2.5 overflow-hidden rounded-lg border border-border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={shotUrl}
                          alt={t("inbox.screenshotAlt")}
                          className="max-h-80 w-full object-contain"
                        />
                        <div className="flex justify-end border-t border-border bg-surface px-2.5 py-2">
                          <a
                            href={shotUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-xs font-medium text-accent hover:underline"
                          >
                            {t("inbox.screenshotFullSize")} {"→"}
                          </a>
                        </div>
                      </div>
                    </details>
                  ) : hasKey ? (
                    <span className="mt-3 inline-flex items-center gap-2 rounded-lg border border-dashed border-border bg-surface px-3 py-2 text-xs text-muted">
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <path d="m3 16 5-5 4 4M14 13l2-2 5 5" />
                        <path d="m4 4 16 16" />
                      </svg>
                      {t("inbox.screenshotUnavailable")}
                    </span>
                  ) : null}

                  {/* Resolved state: who + when, then the optional note. Terminal
                      — this row shows no Resolve control below. */}
                  {isResolved ? (
                    <>
                      <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                        <span aria-hidden="true" className="font-bold">
                          ✓
                        </span>
                        <span>
                          {t("inbox.resolve.resolvedBy", {
                            name: resolverName,
                          })}
                          {row.resolved_at ? (
                            <>
                              {" · "}
                              <time
                                dateTime={row.resolved_at}
                                title={new Date(row.resolved_at).toLocaleString(
                                  locale,
                                )}
                              >
                                {relativeTime(
                                  new Date(row.resolved_at),
                                  now,
                                  locale,
                                )}
                              </time>
                            </>
                          ) : null}
                        </span>
                      </div>
                      {row.resolution_note ? (
                        <div className="mt-2 rounded-r-lg border-l-[3px] border-accent/40 bg-foreground/[0.02] px-3 py-2 text-sm [overflow-wrap:anywhere]">
                          <span className="mb-0.5 block text-[0.65rem] font-semibold tracking-wide text-muted uppercase">
                            {t("inbox.resolve.resolutionNote")}
                          </span>
                          {row.resolution_note}
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {/* Meta footer: role · page · locale · build */}
                  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-border pt-2.5 text-xs text-muted">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-foreground/5 px-2 py-0.5">
                      <span>{t("inbox.fromLabel")}</span>
                      <b className="font-semibold text-foreground">
                        {roleLabel}
                      </b>
                    </span>
                    {row.page_url ? (
                      <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-foreground/5 px-2 py-0.5">
                        <span>{t("inbox.pageLabel")}</span>
                        {isInAppPath(row.page_url) ? (
                          <Link
                            href={row.page_url}
                            className="font-medium text-accent [overflow-wrap:anywhere] hover:underline"
                          >
                            {row.page_url}
                          </Link>
                        ) : (
                          <b className="font-medium text-foreground [overflow-wrap:anywhere]">
                            {row.page_url}
                          </b>
                        )}
                      </span>
                    ) : null}
                    {row.locale ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-foreground/5 px-2 py-0.5">
                        <span>{t("inbox.localeLabel")}</span>
                        <b className="font-semibold text-foreground">
                          {row.locale}
                        </b>
                      </span>
                    ) : null}
                    {build ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-foreground/5 px-2 py-0.5">
                        <span>{t("inbox.buildLabel")}</span>
                        <code className="font-mono text-foreground">
                          {build}
                        </code>
                      </span>
                    ) : null}
                  </div>

                  {/* Action bar — admin-only Resolve. Hidden on terminal rows. */}
                  {isResolved ? null : (
                    <FeedbackResolveForm feedbackId={row.id} />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
