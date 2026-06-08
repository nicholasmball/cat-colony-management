import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveOrg } from "@/lib/active-org";
import { photoSrc } from "@/lib/photo";
import { incidentTypeLabel } from "@/lib/incident";
import {
  IncidentStatusPill,
  UrgentBadge,
} from "@/components/incident-status-pill";
import { IncidentTypeIcon, ChevronIcon, WarningIcon } from "@/components/icons";
import { EmptyState } from "@/components/empty-state";
import { card, pill } from "@/lib/ui";

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";

// Active = the working queue (open + in_progress); Done = the terminal states
// (resolved + the collapsed 'closed').
const ACTIVE_STATUSES = ["open", "in_progress"];
const DONE_STATUSES = ["resolved", "closed"];

type IncidentRow = {
  id: string;
  type: string;
  status: string;
  colony_id: string;
  cat_id: string | null;
  urgency_level_id: string | null;
  reported_by: string | null;
  assigned_to: string | null;
  occurred_at: string;
  created_at: string;
};

// A chip toggle that flips one searchParam on/off while preserving the rest.
function chipHref(
  base: URLSearchParams,
  key: string,
  value: string | null,
): string {
  const next = new URLSearchParams(base);
  if (value === null) next.delete(key);
  else next.set(key, value);
  const qs = next.toString();
  return qs ? `/app/incidents?${qs}` : "/app/incidents";
}

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    urgent?: string;
    colony?: string;
    mine?: string;
    error?: string;
  }>;
}) {
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  // Manager-only screen — feeders have no triage list (reach incidents by link).
  if (org.role !== "admin" && org.role !== "caretaker") redirect("/app/today");

  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const showDone = sp.status === "done";
  const urgentOnly = sp.urgent === "1";
  const mineOnly = sp.mine === "1";
  const colonyFilter = sp.colony && sp.colony !== "all" ? sp.colony : null;

  // The org's urgency levels — needed to (a) optionally filter to the
  // alerts_immediately ones and (b) badge each row. RLS scopes this read.
  const { data: levelData } = await supabase
    .from("incident_urgency_levels")
    .select("id, alerts_immediately")
    .eq("organisation_id", org.organisation_id);
  const urgentLevelIds = new Set(
    (levelData ?? [])
      .filter((l) => l.alerts_immediately)
      .map((l) => l.id as string),
  );

  // Org-scoped incidents query, hitting incidents_org_status_idx via the
  // (organisation_id, status) filter. One query — no per-row fan-out.
  let query = supabase
    .from("incidents")
    .select(
      "id, type, status, colony_id, cat_id, urgency_level_id, reported_by, assigned_to, occurred_at, created_at",
    )
    .eq("organisation_id", org.organisation_id)
    .in("status", showDone ? DONE_STATUSES : ACTIVE_STATUSES)
    .order("occurred_at", { ascending: false });

  if (colonyFilter) query = query.eq("colony_id", colonyFilter);
  if (mineOnly) query = query.eq("assigned_to", user?.id ?? "");
  // Urgent-only: restrict to the org's alerts_immediately level ids. Never pass
  // an empty/placeholder uuid into .in() (that errors in Postgres) — when the
  // org has no urgent levels, nothing can match, so skip the query entirely.
  if (urgentOnly && urgentLevelIds.size > 0) {
    query = query.in("urgency_level_id", [...urgentLevelIds]);
  }

  const noUrgentMatch = urgentOnly && urgentLevelIds.size === 0;
  const { data: incidentData } = noUrgentMatch
    ? { data: [] as IncidentRow[] }
    : await query;
  let incidents = (incidentData ?? []) as IncidentRow[];

  // Urgent + open float to the top, then by time (newest first). A second sort
  // pass over the already time-ordered list.
  const isUrgent = (i: IncidentRow) =>
    i.urgency_level_id !== null && urgentLevelIds.has(i.urgency_level_id);
  incidents = incidents.slice().sort((a, b) => {
    const aTop = isUrgent(a) && a.status === "open" ? 0 : 1;
    const bTop = isUrgent(b) && b.status === "open" ? 0 : 1;
    if (aTop !== bTop) return aTop - bTop;
    return b.occurred_at < a.occurred_at
      ? -1
      : b.occurred_at > a.occurred_at
        ? 1
        : 0;
  });

  // Batch the related lookups — NO N+1. Distinct colony ids, cat ids, reporter/
  // assignee ids and incident ids (for the photo thumbs) each resolved once.
  const colonyIds = [...new Set(incidents.map((i) => i.colony_id))];
  const catIds = [
    ...new Set(incidents.map((i) => i.cat_id).filter((v): v is string => !!v)),
  ];
  const userIds = [
    ...new Set(
      incidents
        .flatMap((i) => [i.reported_by, i.assigned_to])
        .filter((v): v is string => !!v),
    ),
  ];

  const [colonyRows, catRows, attachmentRows, colonyChoices] =
    await Promise.all([
      colonyIds.length
        ? supabase.from("colonies").select("id, name").in("id", colonyIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      catIds.length
        ? supabase.from("cats").select("id, name, temp_id").in("id", catIds)
        : Promise.resolve({
            data: [] as {
              id: string;
              name: string | null;
              temp_id: string | null;
            }[],
          }),
      incidents.length
        ? supabase
            .from("attachments")
            .select("entity_id, storage_path, created_at")
            .eq("entity_type", "incident")
            .in(
              "entity_id",
              incidents.map((i) => i.id),
            )
            .is("deleted_at", null)
            .order("created_at", { ascending: true })
        : Promise.resolve({
            data: [] as {
              entity_id: string;
              storage_path: string;
              created_at: string;
            }[],
          }),
      // All this org's colonies for the filter dropdown.
      supabase
        .from("colonies")
        .select("id, name")
        .eq("organisation_id", org.organisation_id)
        .is("deleted_at", null)
        .order("name", { ascending: true }),
    ]);

  const colonyName = new Map(
    (colonyRows.data ?? []).map((c) => [c.id, c.name]),
  );
  const catName = new Map(
    (catRows.data ?? []).map((c) => [
      c.id,
      c.name ?? c.temp_id ?? "Unnamed cat",
    ]),
  );

  // First attachment per incident → a presigned thumb. Resolve the distinct set
  // once (the rows are already ordered oldest-first, so first wins).
  const firstAttachment = new Map<string, string>();
  for (const a of attachmentRows.data ?? []) {
    if (!firstAttachment.has(a.entity_id))
      firstAttachment.set(a.entity_id, a.storage_path);
  }
  const thumbs = new Map<string, string | null>(
    await Promise.all(
      [...firstAttachment.entries()].map(
        async ([incidentId, key]) =>
          [incidentId, await photoSrc(key)] as [string, string | null],
      ),
    ),
  );

  // Reporter/assignee emails — one service-client lookup per DISTINCT id.
  const emails = new Map<string, string>();
  if (userIds.length) {
    const svc = createServiceClient();
    await Promise.all(
      userIds.map(async (uid) => {
        const { data } = await svc.auth.admin.getUserById(uid);
        emails.set(uid, data.user?.email ?? "unknown");
      }),
    );
  }

  const timeFmt = new Intl.DateTimeFormat(undefined, {
    timeZone: org.timezone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const anyFilterActive = urgentOnly || mineOnly || !!colonyFilter;
  const baseParams = new URLSearchParams();
  if (showDone) baseParams.set("status", "done");
  if (urgentOnly) baseParams.set("urgent", "1");
  if (mineOnly) baseParams.set("mine", "1");
  if (colonyFilter) baseParams.set("colony", colonyFilter);

  // "Clear filters" keeps only the Active/Done toggle, dropping the chips.
  const clearHref = showDone ? "/app/incidents?status=done" : "/app/incidents";

  // Segmented Active/Done preserves the chip filters.
  const toggleHref = (done: boolean) =>
    chipHref(baseParams, "status", done ? "done" : null);
  const chip =
    "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25";
  const chipOn = "border-accent bg-accent/10 text-accent";
  const chipOff = "border-border text-foreground hover:bg-foreground/5";

  return (
    <div className="flex max-w-3xl flex-col gap-5 px-6 py-6 md:px-10">
      <div>
        <h1 className="font-display text-3xl">Incidents</h1>
        <p className="text-sm text-muted">Open problems across your colonies</p>
      </div>

      {sp.error ? (
        <p role="alert" className={errorClass}>
          {sp.error}
        </p>
      ) : null}

      {/* ── Filter bar ── */}
      <div className="flex flex-col gap-3">
        {/* Active / Done segmented toggle */}
        <div
          role="group"
          aria-label="Filter by status"
          className="inline-flex w-fit rounded-full border border-border p-0.5"
        >
          <Link
            href={toggleHref(false)}
            aria-current={!showDone ? "true" : undefined}
            className={`min-h-9 rounded-full px-4 text-sm font-medium transition ${
              !showDone
                ? "bg-accent text-accent-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            Active
          </Link>
          <Link
            href={toggleHref(true)}
            aria-current={showDone ? "true" : undefined}
            className={`min-h-9 rounded-full px-4 text-sm font-medium transition ${
              showDone
                ? "bg-accent text-accent-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            Done
          </Link>
        </div>

        {/* Chip toggles */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={chipHref(baseParams, "urgent", urgentOnly ? null : "1")}
            aria-pressed={urgentOnly}
            className={`${chip} ${urgentOnly ? chipOn : chipOff}`}
          >
            <WarningIcon className="h-4 w-4" aria-hidden />
            Urgent only{urgentOnly ? " ✕" : ""}
          </Link>
          <Link
            href={chipHref(baseParams, "mine", mineOnly ? null : "1")}
            aria-pressed={mineOnly}
            className={`${chip} ${mineOnly ? chipOn : chipOff}`}
          >
            Assigned to me{mineOnly ? " ✕" : ""}
          </Link>
          {/* Colony filter as a tiny GET form so the value preserves others. */}
          <form method="get" className="flex items-center gap-2">
            {showDone ? (
              <input type="hidden" name="status" value="done" />
            ) : null}
            {urgentOnly ? (
              <input type="hidden" name="urgent" value="1" />
            ) : null}
            {mineOnly ? <input type="hidden" name="mine" value="1" /> : null}
            <select
              name="colony"
              defaultValue={colonyFilter ?? "all"}
              aria-label="Filter by colony"
              className={`${chip} ${colonyFilter ? chipOn : chipOff} bg-transparent`}
              // Auto-submit on change for a one-tap field feel.
              // (Progressive enhancement: still submits via the button fallback.)
            >
              <option value="all">All colonies</option>
              {(colonyChoices.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <noscript>
              <button type="submit" className={`${chip} ${chipOff}`}>
                Go
              </button>
            </noscript>
          </form>
          {anyFilterActive ? (
            <Link
              href={clearHref}
              className="text-sm text-accent underline-offset-2 hover:underline"
            >
              Clear filters
            </Link>
          ) : null}
        </div>
      </div>

      {incidents.length === 0 ? (
        anyFilterActive ? (
          <EmptyState
            icon={<WarningIcon className="h-7 w-7" />}
            title="Nothing matches these filters"
            body="No incidents match the filters you've set right now."
            cta={{
              href: clearHref,
              label: "Clear filters",
            }}
          />
        ) : showDone ? (
          <EmptyState
            icon={<WarningIcon className="h-7 w-7" />}
            title="Nothing resolved yet"
            body="Resolved incidents will be listed here for the record."
          />
        ) : (
          <EmptyState
            icon={<WarningIcon className="h-7 w-7" />}
            title="All clear"
            body="No open incidents across your colonies. New reports from feeders will land here."
          />
        )
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {incidents.length} {showDone ? "resolved" : "active"} incident
            {incidents.length === 1 ? "" : "s"}
          </h2>
          <ul className="flex flex-col gap-2">
            {incidents.map((i) => {
              const urgent = isUrgent(i);
              const thumb = thumbs.get(i.id) ?? null;
              const reporter = i.reported_by
                ? (emails.get(i.reported_by) ?? "unknown")
                : null;
              const assignee = i.assigned_to
                ? i.assigned_to === user?.id
                  ? "You"
                  : (emails.get(i.assigned_to) ?? "unknown")
                : "Unassigned";
              return (
                <li key={i.id}>
                  <Link
                    href={`/app/incidents/${i.id}`}
                    className={`${card} flex min-h-[60px] items-center gap-3 px-4 py-3 transition hover:bg-foreground/5 ${
                      urgent && i.status === "open"
                        ? "border-l-4 border-l-red-500"
                        : ""
                    }`}
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-surface">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumb}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <IncidentTypeIcon
                          type={i.type}
                          className="h-5 w-5 text-muted"
                        />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 font-medium">
                        <span className="truncate">
                          {incidentTypeLabel(i.type)}
                        </span>
                        {urgent ? <UrgentBadge /> : null}
                        <IncidentStatusPill status={i.status} />
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span className="truncate">
                          {colonyName.get(i.colony_id) ?? "Colony"}
                        </span>
                        {i.cat_id ? (
                          <>
                            <span aria-hidden>·</span>
                            <span className="truncate">
                              {catName.get(i.cat_id)}
                            </span>
                          </>
                        ) : null}
                        {reporter ? (
                          <>
                            <span aria-hidden>·</span>
                            <span className="truncate">by {reporter}</span>
                          </>
                        ) : null}
                        <span aria-hidden>·</span>
                        <span>{timeFmt.format(new Date(i.occurred_at))}</span>
                        <span aria-hidden>·</span>
                        <span className={pill}>{assignee}</span>
                      </p>
                    </div>
                    <ChevronIcon className="h-4 w-4 shrink-0 text-muted" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
