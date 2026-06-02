import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";

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
        <p className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
          Create an organisation first.{" "}
          <Link href="/app" className="text-teal-700 underline">
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
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Colonies</h1>
          <p className="text-xs text-zinc-500">{org.name}</p>
        </div>
        {canManage ? (
          <Link
            href="/app/colonies/new"
            className="min-h-9 rounded-md bg-teal-700 px-3 text-sm font-medium leading-9 text-white hover:bg-teal-800"
          >
            Add colony
          </Link>
        ) : null}
      </div>

      {colonies.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
          No colonies yet.
          {canManage ? " Add your first one above." : ""}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {colonies.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-3 dark:border-zinc-800"
            >
              <div>
                <p className="text-sm font-medium">{c.name}</p>
                {c.feeding_window_start ? (
                  <p className="text-xs text-zinc-500">
                    Feeds {c.feeding_window_start.slice(0, 5)}
                    {c.feeding_window_end
                      ? `–${c.feeding_window_end.slice(0, 5)}`
                      : ""}
                  </p>
                ) : null}
              </div>
              {!c.is_active ? (
                <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
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
