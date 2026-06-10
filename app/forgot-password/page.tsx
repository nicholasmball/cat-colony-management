import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { requestPasswordReset } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { isLocale } from "@/i18n/locale";
import { btnPrimary, card, fieldLabel, input } from "@/lib/ui";

// Step 1 of the forgot-password flow: request a reset link. Always shows the
// same existence-safe confirmation once submitted (?sent=1). The email is sent
// by Supabase Auth SMTP, not the lib/email layer.
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
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

        {sent ? (
          <div className={`${card} flex flex-col gap-4 p-6`}>
            <h1 className="font-display text-2xl">{t("resetTitle")}</h1>
            <p
              role="status"
              className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950/60 dark:text-green-300"
            >
              {t("resetLinkSent")}
            </p>
            <Link href="/login" className="text-center text-sm text-accent">
              {t("backToSignIn")}
            </Link>
          </div>
        ) : (
          <div className={`${card} flex flex-col gap-4 p-6`}>
            <div className="flex flex-col gap-1">
              <h1 className="font-display text-2xl">{t("resetTitle")}</h1>
              <p className="text-sm text-muted">{t("resetSubtitle")}</p>
            </div>
            <form action={requestPasswordReset} className="flex flex-col gap-4">
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
              <SubmitButton
                pendingText={t("sendingResetLink")}
                className={btnPrimary}
              >
                {t("sendResetLink")}
              </SubmitButton>
            </form>
            <Link href="/login" className="text-center text-sm text-accent">
              {t("backToSignIn")}
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
