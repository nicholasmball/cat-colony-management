import { getTranslations } from "next-intl/server";
import {
  CalendarIcon,
  PawIcon,
  WarningIcon,
  UsersIcon,
  HelpIcon,
} from "@/components/icons";
import { card } from "@/lib/ui";

// In-app Help / quick-start. A concise, friendly, mobile-first guide reachable
// from the nav for EVERY role (feeders most of all — they get no training).
// Pure server component, no data/auth beyond the shared /app layout's gate;
// every string is an i18n leaf under the `help.*` namespace (EN + European PT).
export default async function HelpPage() {
  const t = await getTranslations("help");

  // The four daily questions the app exists to answer (spec north star).
  const questions = ["fed", "seen", "newMissing", "problem"] as const;
  // The ordered 30-second feeding flow.
  const feedingSteps = ["step1", "step2", "step3", "step4", "step5"] as const;
  // Roles, most-privileged first, one line each.
  const roles = ["admin", "caretaker", "feeder"] as const;

  return (
    <div className="flex max-w-2xl flex-col gap-5 px-6 py-6 md:px-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <p className="text-sm text-muted">{t("intro")}</p>
      </header>

      {/* The four daily questions */}
      <section className={`${card} flex flex-col gap-3 p-4`}>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <HelpIcon className="h-5 w-5 shrink-0 text-accent" aria-hidden />
          {t("questions.heading")}
        </h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm marker:text-accent">
          {questions.map((key) => (
            <li key={key}>{t(`questions.${key}`)}</li>
          ))}
        </ul>
      </section>

      {/* Recording a feeding update — the 30-second flow */}
      <section className={`${card} flex flex-col gap-3 p-4`}>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <CalendarIcon className="h-5 w-5 shrink-0 text-accent" aria-hidden />
          {t("feeding.heading")}
        </h2>
        <p className="text-sm text-muted">{t("feeding.intro")}</p>
        <ol className="flex flex-col gap-2 text-sm">
          {feedingSteps.map((key, i) => (
            <li key={key} className="flex items-start gap-3">
              <span
                aria-hidden
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/10 text-xs font-semibold text-accent"
              >
                {i + 1}
              </span>
              <span className="pt-0.5">{t(`feeding.${key}`)}</span>
            </li>
          ))}
        </ol>
        <p className="rounded-lg bg-accent/5 px-3 py-2 text-sm text-foreground/80">
          {t("feeding.offline")}
        </p>
      </section>

      {/* Reporting a new cat */}
      <section className={`${card} flex flex-col gap-3 p-4`}>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <PawIcon className="h-5 w-5 shrink-0 text-accent" aria-hidden />
          {t("newCat.heading")}
        </h2>
        <p className="text-sm text-foreground/80">{t("newCat.body")}</p>
      </section>

      {/* Reporting an incident — urgent vs not urgent */}
      <section className={`${card} flex flex-col gap-3 p-4`}>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <WarningIcon className="h-5 w-5 shrink-0 text-accent" aria-hidden />
          {t("incident.heading")}
        </h2>
        <p className="text-sm text-foreground/80">{t("incident.body")}</p>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex flex-col gap-0.5">
            <dt className="font-semibold text-red-700 dark:text-red-300">
              {t("incident.urgentLabel")}
            </dt>
            <dd className="text-foreground/80">{t("incident.urgent")}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="font-semibold">{t("incident.notUrgentLabel")}</dt>
            <dd className="text-foreground/80">{t("incident.notUrgent")}</dd>
          </div>
        </dl>
      </section>

      {/* Roles */}
      <section className={`${card} flex flex-col gap-3 p-4`}>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <UsersIcon className="h-5 w-5 shrink-0 text-accent" aria-hidden />
          {t("roles.heading")}
        </h2>
        <dl className="flex flex-col gap-2 text-sm">
          {roles.map((role) => (
            <div key={role} className="flex flex-col gap-0.5">
              <dt className="font-semibold">{t(`roles.${role}Label`)}</dt>
              <dd className="text-foreground/80">{t(`roles.${role}`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Language & offline */}
      <section className={`${card} flex flex-col gap-3 p-4`}>
        <h2 className="text-lg font-semibold">{t("language.heading")}</h2>
        <p className="text-sm text-foreground/80">
          {t("language.languageBody")}
        </p>
        <p className="text-sm text-foreground/80">
          {t("language.offlineBody")}
        </p>
      </section>
    </div>
  );
}
