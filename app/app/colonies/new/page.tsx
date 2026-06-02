import Link from "next/link";
import { createColony } from "../actions";
import { SubmitButton } from "@/components/submit-button";
import { btnPrimary, fieldLabel, input } from "@/lib/ui";

export default async function NewColonyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 p-6">
      <Link href="/app/colonies" className="text-sm text-accent">
        ← Colonies
      </Link>
      <h1 className="font-display text-2xl">New colony</h1>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      <form action={createColony} className="flex flex-col gap-4">
        <label className={fieldLabel}>
          <span>Name</span>
          <input name="name" required className={input} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={fieldLabel}>
            <span>Feeding from</span>
            <input type="time" name="feeding_window_start" className={input} />
          </label>
          <label className={fieldLabel}>
            <span>to</span>
            <input type="time" name="feeding_window_end" className={input} />
          </label>
        </div>
        <label className={fieldLabel}>
          <span>Notes (optional)</span>
          <textarea name="notes" rows={3} className={`${input} py-2`} />
        </label>
        <SubmitButton pendingText="Creating…" className={btnPrimary}>
          Create colony
        </SubmitButton>
      </form>
    </div>
  );
}
