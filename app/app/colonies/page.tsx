import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { btnPrimary, card } from "@/lib/ui";
import { ChevronIcon, PawIcon } from "@/components/icons";
import { EmptyState } from "@/components/empty-state";

type Colony = {
  id: string;
  name: string;
  is_active: boolean;
  feeding_window_start: string | null;
  feeding_window_end: string | null;
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
    .select("id, name, is_active, feeding_window_start, feeding_window_end")
    .eq("organisation_id", org.organisation_id)
    .is("deleted_at", null)
    .order("name");
  const colonies = (data ?? []) as Colony[];
  const canManage = org.role === "admin" || org.role === "caretaker";

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
          {colonies.map((c) => (
            <li key={c.id}>
              <Link
                href={`/app/colonies/${c.id}`}
                className={`${card} flex items-center justify-between px-4 py-3 transition hover:border-accent/50`}
              >
                <div>
                  <p className="font-medium">{c.name}</p>
                  {c.feeding_window_start ? (
                    <p className="text-xs text-muted">
                      {t("feedsAt", {
                        time: `${c.feeding_window_start.slice(0, 5)}${
                          c.feeding_window_end
                            ? `–${c.feeding_window_end.slice(0, 5)}`
                            : ""
                        }`,
                      })}
                    </p>
                  ) : null}
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
          ))}
        </ul>
      )}
    </div>
  );
}
