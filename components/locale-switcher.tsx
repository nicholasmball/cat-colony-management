"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { SUPPORTED_LOCALES, type Locale } from "@/i18n/locale";
import { setLocale } from "@/app/locale-actions";

// EN | PT segmented control — a labelled radiogroup of real buttons, matching
// the app's segmented-toggle look (rounded-full bordered group, accent fill on
// the selected segment), reused from the incidents Active/Done toggle and the
// feed form's Fed/Not fed control. Text labels ("EN"/"PT"), NOT flags: flags are
// countries not languages (a PT flag excludes Brazilian readers; a UK/US flag is
// a poor stand-in for English). The accessible name carries the meaning for AT.
//
// Order is fixed (EN | PT), independent of the active locale, so the control
// doesn't reflow when you switch. Re-selecting the current locale is a no-op
// (idempotent — no needless round-trip). aria-busy + a dim state acknowledge the
// ~200–400ms cookie+revalidate round-trip; an aria-live region announces the
// result after the re-render (the label string itself is in the new locale).
export function LocaleSwitcher({
  locale,
  size = "default",
  className = "",
}: {
  locale: Locale;
  size?: "default" | "compact";
  className?: string;
}) {
  const t = useTranslations("locale");
  const [pending, startTransition] = useTransition();

  // Stable EN | PT order regardless of which is active.
  const ordered: Locale[] = ["en", "pt"];

  function select(next: Locale) {
    if (next === locale || pending) return; // idempotent + no double-submit
    const data = new FormData();
    data.set("locale", next);
    startTransition(() => setLocale(data));
  }

  const seg =
    size === "compact" ? "min-h-10 min-w-12 px-3.5" : "min-h-11 min-w-14 px-4";

  return (
    <div className={`inline-flex flex-col gap-1 ${className}`}>
      <div
        role="radiogroup"
        aria-label={t("ariaLabel")}
        aria-busy={pending}
        className={`inline-flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5 ${
          pending ? "opacity-60" : ""
        }`}
      >
        {ordered.map((code) => {
          const on = code === locale;
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={t(code)}
              disabled={pending}
              onClick={() => select(code)}
              className={`inline-flex items-center justify-center rounded-full text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed ${seg} ${
                on
                  ? "bg-accent text-accent-foreground"
                  : "text-muted hover:bg-foreground/5 hover:text-foreground"
              }`}
            >
              {/* Two-letter code, uppercase: legible at 375px, language-neutral,
                  reads cleanly in screen readers (flags read as country names). */}
              {SUPPORTED_LOCALES.includes(code) ? code.toUpperCase() : code}
            </button>
          );
        })}
      </div>
      {/* Announce the active language in that language after the re-render. */}
      <span aria-live="polite" className="sr-only">
        {t("announce", { language: t(`name.${locale}`) })}
      </span>
    </div>
  );
}
