import { getTranslations } from "next-intl/server";
import { FeedbackForm } from "@/components/feedback-form";

// In-app feedback / bug-report channel for UAT. Reachable from the nav for EVERY
// role (the auth gate is the shared /app layout). Mirrors the Help page shell —
// max-w-2xl, px-6 py-6, h1 + intro — then renders the client form. Every string
// is an i18n leaf under `feedback.*` (EN + European PT).
export default async function FeedbackPage() {
  const t = await getTranslations("feedback");

  return (
    <div className="flex max-w-2xl flex-col gap-5 px-6 py-6 md:px-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <p className="text-sm text-muted">{t("intro")}</p>
      </header>

      <FeedbackForm />
    </div>
  );
}
