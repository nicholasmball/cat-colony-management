import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { updateColony, archiveColony } from "../../actions";
import { SubmitButton } from "@/components/submit-button";
import { btnGhost, btnPrimary, fieldLabel, input } from "@/lib/ui";

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";

export default async function EditColony({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getTranslations("colonies");
  const supabase = await createClient();

  const { data: colony } = await supabase
    .from("colonies")
    .select(
      "id, name, notes, is_active, feeding_window_start, feeding_window_end",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!colony) notFound();

  return (
    <div className="flex max-w-xl flex-col gap-5 px-6 py-6 md:px-10">
      <Link href={`/app/colonies/${id}`} className="text-sm text-accent">
        ← {colony.name}
      </Link>
      <h1 className="font-display text-3xl">{t("editColonyTitle")}</h1>

      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}

      <form action={updateColony} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={id} />
        <label className={fieldLabel}>
          <span>{t("name")}</span>
          <input
            name="name"
            required
            defaultValue={colony.name}
            className={input}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={fieldLabel}>
            <span>{t("feedingFrom")}</span>
            <input
              type="time"
              name="feeding_window_start"
              defaultValue={colony.feeding_window_start?.slice(0, 5) ?? ""}
              className={input}
            />
          </label>
          <label className={fieldLabel}>
            <span>{t("feedingTo")}</span>
            <input
              type="time"
              name="feeding_window_end"
              defaultValue={colony.feeding_window_end?.slice(0, 5) ?? ""}
              className={input}
            />
          </label>
        </div>
        <label className={fieldLabel}>
          <span>{t("notes")}</span>
          <textarea
            name="notes"
            rows={3}
            defaultValue={colony.notes ?? ""}
            className={`${input} py-2`}
          />
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={colony.is_active}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          {t("activeLabel")}
        </label>
        <SubmitButton pendingText={t("saving")} className={btnPrimary}>
          {t("saveChanges")}
        </SubmitButton>
      </form>

      <form action={archiveColony} className="border-t border-border pt-4">
        <input type="hidden" name="id" value={id} />
        <SubmitButton
          pendingText={t("archiving")}
          className={`${btnGhost} text-red-700 dark:text-red-300`}
        >
          {t("archiveColony")}
        </SubmitButton>
        <p className="mt-1.5 text-xs text-muted">{t("archiveHint")}</p>
      </form>
    </div>
  );
}
