import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { isLocale } from "@/i18n/locale";
import { Logo } from "@/components/logo";
import { AppNav } from "@/components/app-nav";
import { AccountMenu } from "@/components/account-menu";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { signOut } from "./actions";

// Responsive shell: left sidebar on desktop, top bar + bottom tab bar on mobile.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const email = user.email ?? "";
  const org = await getActiveOrg();
  const role = org?.role;
  const localeValue = await getLocale();
  const locale = isLocale(localeValue) ? localeValue : "pt";
  const t = await getTranslations();

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="px-5 py-5">
          <Link href="/app" aria-label={t("nav.home")}>
            <Logo width={132} />
          </Link>
        </div>
        <AppNav variant="sidebar" role={role} />
        <div className="mt-auto border-t border-border p-3">
          <p className="truncate px-2 text-xs text-muted" title={email}>
            {email}
          </p>
          <div className="mt-2 flex flex-col gap-1 px-2">
            <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">
              {t("locale.label")}
            </span>
            <LocaleSwitcher locale={locale} size="compact" />
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="mt-2 w-full rounded-lg px-2 py-2 text-left text-sm text-foreground transition hover:bg-foreground/5"
            >
              {t("common.signOut")}
            </button>
          </form>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-h-dvh flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface/90 px-4 py-2.5 backdrop-blur md:hidden">
          <Link href="/app" aria-label={t("nav.home")}>
            <Logo width={104} />
          </Link>
          <AccountMenu email={email} locale={locale} />
        </header>

        <main className="flex-1 pb-24 md:pb-10">{children}</main>

        {/* Mobile bottom tab bar (hidden on desktop) */}
        <AppNav variant="tabbar" role={role} />
      </div>
    </div>
  );
}
