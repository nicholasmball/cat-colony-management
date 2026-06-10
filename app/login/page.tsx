import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { login } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { isLocale } from "@/i18n/locale";
import { btnPrimary, fieldLabel, input } from "@/lib/ui";

// Invite-only: there is no public sign-up. Accounts are created by an
// administrator; this page lets an existing volunteer sign in.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const t = await getTranslations("auth");
  const localeValue = await getLocale();
  const locale = isLocale(localeValue) ? localeValue : "pt";

  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="absolute right-4 top-4 z-10">
        <LocaleSwitcher locale={locale} size="compact" />
      </div>
      <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-1 flex-col justify-center gap-8 p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo width={184} />
          <p className="text-sm text-muted">{t("signInToYourAccount")}</p>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300"
          >
            {error}
          </p>
        ) : null}

        <form action={login} className="flex flex-col gap-4">
          <label className={fieldLabel}>
            <span>{t("email")}</span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className={input}
            />
          </label>
          <label className={fieldLabel}>
            <span>{t("password")}</span>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className={input}
            />
          </label>
          <SubmitButton pendingText={t("signingIn")} className={btnPrimary}>
            {t("signIn")}
          </SubmitButton>
        </form>

        <div className="flex flex-col items-center gap-2 text-center text-xs">
          <Link href="/forgot-password" className="text-accent">
            {t("forgotPassword")}
          </Link>
          <p className="text-muted">{t("noAccount")}</p>
        </div>
      </main>
    </div>
  );
}
