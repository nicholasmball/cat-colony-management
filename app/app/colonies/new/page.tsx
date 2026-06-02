import Link from "next/link";
import { createColony } from "../actions";
import { SubmitButton } from "@/components/submit-button";

export default async function NewColonyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <Link href="/app/colonies" className="text-sm text-teal-700 underline">
          ← Colonies
        </Link>
      </div>
      <h1 className="text-lg font-semibold tracking-tight">New colony</h1>

      {error ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      <form action={createColony} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Name</span>
          <input
            name="name"
            required
            className="min-h-11 rounded-md border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Feeding from</span>
            <input
              type="time"
              name="feeding_window_start"
              className="min-h-11 rounded-md border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">to</span>
            <input
              type="time"
              name="feeding_window_end"
              className="min-h-11 rounded-md border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Notes (optional)</span>
          <textarea
            name="notes"
            rows={3}
            className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <SubmitButton
          pendingText="Creating…"
          className="min-h-11 rounded-md bg-teal-700 px-4 font-medium text-white hover:bg-teal-800"
        >
          Create colony
        </SubmitButton>
      </form>
    </div>
  );
}
