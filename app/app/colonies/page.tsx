import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { btnPrimary, card } from "@/lib/ui";

type Colony = {
  id: string;
  name: string;
  is_active: boolean;
  feeding_window_start: string | null;
  feeding_window_end: string | null;
};

export default async function ColoniesPage() {
  const org = await getActiveOrg();
  if (!org) {
    return (
      <div className="mx-auto max-w-md p-6">
        <p className={`${card} p-4 text-sm text-muted`}>
          Create an organisation first.{" "}
          <Link href="/app" className="text-accent underline">
            Go home
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
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Colonies</h1>
          <p className="text-xs text-muted">{org.name}</p>
        </div>
        {canManage ? (
          <Link href="/app/colonies/new" className={`${btnPrimary} text-sm`}>
            Add colony
          </Link>
        ) : null}
      </div>

      {colonies.length === 0 ? (
        <p className={`${card} p-6 text-center text-sm text-muted`}>
          No colonies yet.{canManage ? " Add your first one above." : ""}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {colonies.map((c) => (
            <li
              key={c.id}
              className={`${card} flex items-center justify-between px-4 py-3`}
            >
              <div>
                <p className="font-medium">{c.name}</p>
                {c.feeding_window_start ? (
                  <p className="text-xs text-muted">
                    Feeds {c.feeding_window_start.slice(0, 5)}
                    {c.feeding_window_end
                      ? `–${c.feeding_window_end.slice(0, 5)}`
                      : ""}
                  </p>
                ) : null}
              </div>
              {!c.is_active ? (
                <span className="rounded-full bg-foreground/10 px-2.5 py-0.5 text-xs text-muted">
                  inactive
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
