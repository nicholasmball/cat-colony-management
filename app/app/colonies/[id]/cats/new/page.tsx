import Link from "next/link";
import { createCat } from "../../../actions";
import { SubmitButton } from "@/components/submit-button";
import { btnPrimary, fieldLabel, input } from "@/lib/ui";

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";

export default async function NewCat({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  return (
    <div className="flex max-w-xl flex-col gap-5 px-6 py-6 md:px-10">
      <Link href={`/app/colonies/${id}`} className="text-sm text-accent">
        ← Colony
      </Link>
      <h1 className="font-display text-3xl">Add cat</h1>

      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}

      <form action={createCat} className="flex flex-col gap-4">
        <input type="hidden" name="colony_id" value={id} />
        <label className={fieldLabel}>
          <span>Name</span>
          <input name="name" className={input} />
        </label>
        <label className={fieldLabel}>
          <span>Temporary ID</span>
          <input
            name="temp_id"
            placeholder="e.g. Ginger-by-the-bins"
            className={input}
          />
        </label>
        <p className="-mt-2 text-xs text-muted">
          Enter a name or a temporary ID — at least one. Everything else is
          optional.
        </p>
        <label className={fieldLabel}>
          <span>Colour / markings</span>
          <input name="colour" className={input} />
        </label>
        <label className={fieldLabel}>
          <span>Notes</span>
          <textarea name="notes" rows={3} className={`${input} py-2`} />
        </label>
        <SubmitButton pendingText="Adding…" className={btnPrimary}>
          Add cat
        </SubmitButton>
      </form>
    </div>
  );
}
