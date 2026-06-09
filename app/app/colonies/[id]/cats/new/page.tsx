import Link from "next/link";
import { getTranslations } from "next-intl/server";
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
  const t = await getTranslations("cats");

  return (
    <div className="flex max-w-xl flex-col gap-5 px-6 py-6 md:px-10">
      <Link href={`/app/colonies/${id}`} className="text-sm text-accent">
        {t("backToColonyShort")}
      </Link>
      <h1 className="font-display text-3xl">{t("addTitle")}</h1>

      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}

      <form action={createCat} className="flex flex-col gap-4">
        <input type="hidden" name="colony_id" value={id} />
        <p className="text-sm text-muted">{t("addLede")}</p>
        <label className={fieldLabel}>
          <span>{t("name")}</span>
          <input
            name="name"
            placeholder={t("namePlaceholderManager")}
            className={input}
          />
        </label>
        <label className={fieldLabel}>
          <span>
            {t("description")}{" "}
            <span className="font-normal text-muted">
              {t("descriptionIfNoName")}
            </span>
          </span>
          <input
            name="temp_id"
            placeholder={t("descriptionPlaceholderManager")}
            className={input}
          />
        </label>
        <label className={fieldLabel}>
          <span>{t("colourMarkings")}</span>
          <input name="colour" className={input} />
        </label>
        <label className={fieldLabel}>
          <span>{t("notes")}</span>
          <textarea name="notes" rows={3} className={`${input} py-2`} />
        </label>
        <SubmitButton pendingText={t("adding")} className={btnPrimary}>
          {t("addTitle")}
        </SubmitButton>
      </form>
    </div>
  );
}
