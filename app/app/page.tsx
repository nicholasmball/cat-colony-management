import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createOrganisation } from "./actions";

type MembershipRow = {
  role: string;
  organisation_id: string;
  organisations: { name: string } | null;
};

export default async function AppHome({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS scopes this to the caller's own memberships + organisations.
  const { data } = await supabase
    .from("memberships")
    .select("role, organisation_id, organisations(name)")
    .is("deleted_at", null);
  const memberships = (data ?? []) as unknown as MembershipRow[];

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-6">
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Your organisations
        </h2>
        {memberships.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
            You&rsquo;re not part of an organisation yet. Create one below to
            get started, or ask an admin to invite you.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {memberships.map((m) => (
              <li
                key={m.organisation_id}
                className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
              >
                <span className="font-medium">
                  {m.organisations?.name ?? "Organisation"}
                </span>
                <span className="rounded-full bg-teal-700/10 px-2 py-0.5 text-xs text-teal-800 dark:text-teal-300">
                  {m.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Create an organisation
        </h2>
        <form action={createOrganisation} className="flex gap-2">
          <input
            name="name"
            required
            placeholder="Organisation name"
            className="min-h-11 flex-1 rounded-md border border-zinc-300 px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="min-h-11 rounded-md bg-teal-700 px-4 text-sm font-medium text-white hover:bg-teal-800"
          >
            Create
          </button>
        </form>
        <p className="text-xs text-zinc-500">
          You&rsquo;ll become its administrator.
        </p>
      </section>
    </div>
  );
}
