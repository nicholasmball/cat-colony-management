import { useTranslations } from "next-intl";

export default function Home() {
  const t = useTranslations("home");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("tagline")}</p>
      <p className="rounded-full bg-teal-700/10 px-3 py-1 text-xs font-medium text-teal-800 dark:text-teal-300">
        {t("status")}
      </p>
    </main>
  );
}
