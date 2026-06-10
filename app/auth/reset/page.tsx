import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { setNewPassword } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { isLocale } from "@/i18n/locale";
import { btnPrimary, card, fieldLabel, input } from "@/lib/ui";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";

// Step 2 of the forgot-password flow: choose a new password. Reached via the
// Supabase recovery link → /auth/confirm (sets the session) → here. The action
// updates the password for the now-authenticated user.
export default async function ResetPasswordPage({
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
        </div>

        <div className={`${card} flex flex-col gap-4 p-6`}>
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-2xl">{t("newPasswordTitle")}</h1>
            <p className="text-sm text-muted">{t("newPasswordSubtitle")}</p>
          </div>

          {error ? <p className={errorClass}>{error}</p> : null}

          <form action={setNewPassword} className="flex flex-col gap-3">
            <label className={fieldLabel}>
              <span>{t("newPassword")}</span>
              <input
                name="password"
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                className={input}
              />
            </label>
            <label className={fieldLabel}>
              <span>{t("confirmPassword")}</span>
              <input
                name="confirm"
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                className={input}
              />
            </label>
            <p className="-mt-1 text-xs text-muted">{t("atLeast8")}</p>
            <SubmitButton
              pendingText={t("updatingPassword")}
              className={`${btnPrimary} w-full`}
            >
              {t("updatePassword")}
            </SubmitButton>
          </form>
          <Link href="/login" className="text-center text-sm text-accent">
            {t("backToSignIn")}
          </Link>
        </div>
      </main>
    </div>
  );
}
