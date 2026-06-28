import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FeedbackForm } from "@/components/feedback-form";
import { getActiveOrg } from "@/lib/active-org";
import { card, pill } from "@/lib/ui";
import { MegaphoneIcon, ChevronIcon } from "@/components/icons";

// In-app feedback / bug-report channel for UAT. Reachable from the nav for EVERY
// role (the auth gate is the shared /app layout). Mirrors the Help page shell —
// max-w-2xl, px-6 py-6, h1 + intro — then renders the client form. Every string
// is an i18n leaf under `feedback.*` (EN + European PT).
export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const t = await getTranslations("feedback");

  // The Feedback nav link carries the route the user was on as ?from=… (SPA
  // navigation leaves document.referrer blank, so the link is the reliable
  // source). Only accept in-app paths — never an arbitrary/external value.
  const { from } = await searchParams;
  const initialPageUrl =
    typeof from === "string" && from.startsWith("/app") ? from : null;

  // Discoverability (D-2): admins get a link to the read-only inbox of the
  // team's submissions. Gated EXACTLY like the Members page — only org admins
  // ever see it; the sidebar "Feedback" item still opens this form for everyone.
  const org = await getActiveOrg();
  const isAdmin = org?.role === "admin";

  return (
    <div className="flex max-w-2xl flex-col gap-5 px-6 py-6 md:px-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <p className="text-sm text-muted">{t("intro")}</p>
      </header>

      {isAdmin ? (
        <Link
          href="/app/feedback/inbox"
          aria-label={t("inbox.viewInboxAria")}
          className={`${card} flex min-h-11 items-center gap-3 px-3.5 py-2.5 transition hover:bg-accent/5`}
        >
          <span aria-hidden="true" className="text-accent">
            <MegaphoneIcon width={20} height={20} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-semibold">
              {t("inbox.viewInbox")}
            </span>
            <span className="text-xs text-muted">
              {t("inbox.viewInboxSub")}
            </span>
          </span>
          <span className={pill}>{t("inbox.adminBadge")}</span>
          <ChevronIcon
            width={18}
            height={18}
            className="text-muted"
            aria-hidden="true"
          />
        </Link>
      ) : null}

      <FeedbackForm initialPageUrl={initialPageUrl} />
    </div>
  );
}
