import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createColony } from "../actions";
import { SubmitButton } from "@/components/submit-button";
import { btnPrimary, fieldLabel, input } from "@/lib/ui";

export default async function NewColonyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const t = await getTranslations("colonies");

  return (
    <div className="flex max-w-xl flex-col gap-5 px-6 py-6 md:px-10">
      <Link href="/app/colonies" className="text-sm text-accent">
        {t("backToColonies")}
      </Link>
      <h1 className="font-display text-2xl">{t("newTitle")}</h1>

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
          <span>{t("name")}</span>
          <input name="name" required className={input} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={fieldLabel}>
            <span>{t("feedingFrom")}</span>
            <input type="time" name="feeding_window_start" className={input} />
          </label>
          <label className={fieldLabel}>
            <span>{t("feedingTo")}</span>
            <input type="time" name="feeding_window_end" className={input} />
          </label>
        </div>
        <label className={fieldLabel}>
          <span>{t("notesOptional")}</span>
          <textarea name="notes" rows={3} className={`${input} py-2`} />
        </label>
        <SubmitButton pendingText={t("creating")} className={btnPrimary}>
          {t("createColony")}
        </SubmitButton>
      </form>
    </div>
  );
}
