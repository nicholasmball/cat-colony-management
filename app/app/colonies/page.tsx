import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { btnPrimary, card } from "@/lib/ui";
import { ChevronIcon, PawIcon } from "@/components/icons";
import { EmptyState } from "@/components/empty-state";
import { getWindowsByColony } from "./feeding-windows";
import { windowRangeLabel } from "@/lib/feeding-windows";

type Colony = {
  id: string;
  name: string;
  is_active: boolean;
};

export default async function ColoniesPage() {
  const t = await getTranslations("colonies");
  const tc = await getTranslations("common");
  const org = await getActiveOrg();
  if (!org) {
    return (
      <div className="max-w-md px-6 py-6 md:px-10">
        <p className={`${card} p-4 text-sm text-muted`}>
          {t("createOrgFirst")}{" "}
          <Link href="/app" className="text-accent underline">
            {tc("goHome")}
          </Link>
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("colonies")
    .select("id, name, is_active")
    .eq("organisation_id", org.organisation_id)
    .is("deleted_at", null)
    .order("name");
  const colonies = (data ?? []) as Colony[];
  const canManage = org.role === "admin" || org.role === "caretaker";

  // Feeding windows for every listed colony — one batched read, grouped + ordered
  // in memory. The row shows the first window + "+N more" (the whole row links to
  // detail, where all windows are listed); 0 windows reads "No feeding time set".
  const windowsByColony = await getWindowsByColony(
    supabase,
    colonies.map((c) => c.id),
    org.organisation_id,
  );

  return (
    <div className="flex max-w-3xl flex-col gap-4 px-6 py-6 md:px-10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">{t("title")}</h1>
          <p className="text-xs text-muted">{org.name}</p>
        </div>
        {canManage ? (
          <Link href="/app/colonies/new" className={`${btnPrimary} text-sm`}>
            {t("addColony")}
          </Link>
        ) : null}
      </div>

      {colonies.length === 0 ? (
        <EmptyState
          icon={<PawIcon className="h-7 w-7" />}
          title={t("emptyTitle")}
          body={t("emptyBody")}
          cta={
            canManage
              ? { href: "/app/colonies/new", label: t("addFirstColony") }
              : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {colonies.map((c) => {
            const windows = windowsByColony.get(c.id) ?? [];
            const ranges = windows
              .map((w) => windowRangeLabel(w.window_start, w.window_end))
              .filter(Boolean);
            const extra = ranges.length - 1;
            return (
              <li key={c.id}>
                <Link
                  href={`/app/colonies/${c.id}`}
                  className={`${card} flex items-center justify-between px-4 py-3 transition hover:border-accent/50`}
                >
                  <div>
                    <p className="font-medium">{c.name}</p>
                    {ranges.length > 0 ? (
                      <p
                        className="flex flex-wrap items-center gap-1.5 text-xs text-muted"
                        title={t("feedsAt", { time: ranges.join(" · ") })}
                      >
                        <span>{t("feedsAt", { time: ranges[0] })}</span>
                        {extra > 0 ? (
                          <span className="font-semibold">
                            {t("moreWindows", { count: extra })}
                          </span>
                        ) : null}
                      </p>
                    ) : (
                      <p className="text-xs text-muted">
                        {t("noFeedingWindow")}
                      </p>
                    )}
                  </div>
                  <span className="flex items-center gap-2">
                    {!c.is_active ? (
                      <span className="rounded-full bg-foreground/10 px-2.5 py-0.5 text-xs text-muted">
                        {tc("inactive")}
                      </span>
                    ) : null}
                    <ChevronIcon className="h-5 w-5 text-muted" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
