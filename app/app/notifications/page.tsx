import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { notificationKeys } from "@/lib/notifications";
import { relativeTime } from "@/lib/relative-time";
import { BellIcon } from "@/components/icons";
import { EmptyState } from "@/components/empty-state";
import { NotificationRow } from "@/components/notification-row";
import { markAllRead } from "./actions";

// The in-app notification centre. Shows ALL of the CURRENT USER'S notification
// rows for the active org, newest-first — regardless of `channels` (Option 1:
// even an urgent push/SMS-only alert must be visible in-app so a manager who
// missed the push still sees it here). Read-only + read_at flips; no senders,
// no detection, no realtime.
//
// SECURITY: the RLS-bound createClient() is used — "recipients read own
// notifications" (0002) scopes the SELECT to recipient_id = auth.uid(); we add
// organisation_id = active org so a multi-org recipient only sees the active
// org's feed. No service client here (the user reads THEIR OWN rows).

type Severity = "urgent" | "routine";

type NotificationRowData = {
  id: string;
  type: string;
  severity: Severity | null;
  message_key: string | null;
  message_params: Record<string, unknown> | null;
  colony_id: string | null;
  cat_id: string | null;
  incident_id: string | null;
  read_at: string | null;
  created_at: string;
};

// Resolve the entity a row links to. Incident → triage detail; cat → the cat
// page (needs its colony id); colony → colony page. Null when nothing applies
// (the row is then non-navigable but still renders + marks read).
function entityHref(row: NotificationRowData): string | null {
  if (row.incident_id) return `/app/incidents/${row.incident_id}`;
  if (row.cat_id && row.colony_id)
    return `/app/colonies/${row.colony_id}/cats/${row.cat_id}`;
  if (row.colony_id) return `/app/colonies/${row.colony_id}`;
  return null;
}

export default async function NotificationsPage() {
  const org = await getActiveOrg();
  if (!org) redirect("/app");

  const t = await getTranslations("notifications");
  const tType = await getTranslations("incidents.type");
  const tAlerts = await getTranslations("alerts");
  const locale = await getLocale();
  const displayLocale = locale === "pt" ? "pt-PT" : "en-GB";
  const now = new Date();

  const supabase = await createClient();
  // RLS scopes to the caller's own rows; we add the active-org filter. NO
  // `channels` filter — Option 1 shows every row the recipient has.
  const { data } = await supabase
    .from("notifications")
    .select(
      "id, type, severity, message_key, message_params, colony_id, cat_id, incident_id, read_at, created_at",
    )
    .eq("organisation_id", org.organisation_id)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as NotificationRowData[];

  const unreadCount = rows.filter((r) => r.read_at === null).length;

  // Render one row's title + body from its stored message_key/params. The
  // params are mostly self-contained (colonyName/reporterName/catName/hours/
  // count are stored verbatim); only {incidentType} is a raw enum value the
  // recipient's locale must translate via the incidents.type.* catalog. Missing
  // params degrade gracefully — next-intl leaves an unmatched {placeholder}
  // untouched, so we pre-fill any referenced param with a humane fallback and
  // wrap translation so a bad row never crashes the whole feed.
  function renderRow(row: NotificationRowData) {
    const params: Record<string, unknown> = { ...(row.message_params ?? {}) };
    // Translate the incident type enum into the recipient's locale; if absent,
    // fall back so the title doesn't show a raw "{incidentType}".
    if (typeof params.incidentType === "string") {
      params.incidentType = tType(params.incidentType);
    }
    // Defensive defaults for any param a malformed row might omit. ICU `count`
    // is left numeric (0 if missing) so the plural form still resolves.
    const safe: Record<string, string | number> = {
      colonyName: "",
      reporterName: "",
      catName: "",
      incidentType: "",
      hours: 0,
      count: 0,
      ...params,
    } as Record<string, string | number>;

    const { titleKey, bodyKey } = notificationKeys(row.type, params);
    // Strip the "alerts." prefix — we hold the alerts-namespaced translator.
    const tk = titleKey.replace(/^alerts\./, "");
    const bk = bodyKey.replace(/^alerts\./, "");
    let title: string;
    let body: string;
    try {
      title = tAlerts(tk, safe);
    } catch {
      title = t("title");
    }
    try {
      body = tAlerts(bk, safe);
    } catch {
      body = "";
    }
    return { title, body };
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5 px-6 py-6 md:px-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-3xl">
            <BellIcon className="h-7 w-7 text-accent" aria-hidden />
            {t("title")}
          </h1>
          <p className="text-sm text-muted">
            {unreadCount > 0
              ? t("unreadCount", { count: unreadCount })
              : t("subtitle")}
          </p>
        </div>
        {unreadCount > 0 ? (
          <form action={markAllRead}>
            <button
              type="submit"
              className="inline-flex min-h-9 items-center rounded-full border border-border px-3 text-sm font-medium text-foreground transition hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
            >
              {t("markAllRead")}
            </button>
          </form>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<BellIcon className="h-7 w-7" />}
          title={t("emptyTitle")}
          body={t("emptyBody")}
        />
      ) : unreadCount === 0 ? (
        // All-read state — distinct, reassuring, but still lists the history.
        <>
          <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-border px-6 py-6 text-center">
            <span
              aria-hidden
              className="grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
              >
                <path d="m5 12.5 4.5 4.5L19 7" />
              </svg>
            </span>
            <p className="font-medium">{t("allReadTitle")}</p>
            <p className="max-w-xs text-sm text-muted">{t("allReadBody")}</p>
          </div>
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const { title, body } = renderRow(row);
              const urgent = row.severity === "urgent";
              return (
                <NotificationRow
                  key={row.id}
                  id={row.id}
                  href={entityHref(row)}
                  title={title}
                  body={body}
                  meta={relativeTime(
                    new Date(row.created_at),
                    now,
                    displayLocale,
                  )}
                  severityLabel={
                    urgent ? t("severityUrgent") : t("severityRoutine")
                  }
                  severityUrgent={urgent}
                  unread={false}
                  markReadLabel={t("markRead")}
                  markReadAria={t("markReadAria", { title })}
                />
              );
            })}
          </ul>
        </>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const { title, body } = renderRow(row);
            const urgent = row.severity === "urgent";
            const unread = row.read_at === null;
            return (
              <NotificationRow
                key={row.id}
                id={row.id}
                href={entityHref(row)}
                title={title}
                body={body}
                meta={relativeTime(
                  new Date(row.created_at),
                  now,
                  displayLocale,
                )}
                severityLabel={
                  urgent ? t("severityUrgent") : t("severityRoutine")
                }
                severityUrgent={urgent}
                unread={unread}
                markReadLabel={t("markRead")}
                markReadAria={t("markReadAria", { title })}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
