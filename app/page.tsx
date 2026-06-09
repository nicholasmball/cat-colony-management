import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { isLocale } from "@/i18n/locale";
import { btnPrimary } from "@/lib/ui";

export default async function Home() {
  const t = await getTranslations("home");
  const localeValue = await getLocale();
  const locale = isLocale(localeValue) ? localeValue : "pt";

  return (
    <div className="relative flex min-h-dvh flex-col">
      {/* Pre-auth language switcher, pinned top-right so a volunteer can pick
          their language before signing in (learned-once placement). */}
      <div className="absolute right-4 top-4 z-10">
        <LocaleSwitcher locale={locale} size="compact" />
      </div>
      <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-1 flex-col items-center justify-center gap-8 p-6 text-center">
        <Logo width={224} />
        <p className="font-display text-xl text-foreground">{t("tagline")}</p>
        <Link href="/login" className={`${btnPrimary} w-full`}>
          {t("signin")}
        </Link>
        <p className="text-xs uppercase tracking-wide text-muted">
          {t("title")}
        </p>
      </main>
    </div>
  );
}
