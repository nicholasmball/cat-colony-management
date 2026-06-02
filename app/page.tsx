import Link from "next/link";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/logo";
import { btnPrimary } from "@/lib/ui";

export default function Home() {
  const t = useTranslations("home");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-1 flex-col items-center justify-center gap-8 p-6 text-center">
      <Logo width={224} />
      <p className="font-display text-xl text-foreground">{t("tagline")}</p>
      <Link href="/login" className={`${btnPrimary} w-full`}>
        {t("signin")}
      </Link>
      <p className="text-xs uppercase tracking-wide text-muted">{t("title")}</p>
    </main>
  );
}
