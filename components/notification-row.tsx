"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { ReactNode } from "react";
import { BellIcon, WarningIcon } from "@/components/icons";
import { card } from "@/lib/ui";
import { markRead } from "@/app/app/notifications/actions";

// One notification in the feed. Interactive (client) because a tap must BOTH
// mark the row read AND navigate to the linked entity — two effects a plain
// <Link> or a plain <form> can't do together. The per-row "Mark read" control
// marks WITHOUT navigating. All copy is pre-translated by the server page and
// passed in as props, so this component stays next-intl-free.
//
// Severity is shown as ICON + TEXT (never colour alone, WCAG 1.4.1): an urgent
// row gets a red warning glyph + the "Urgent" word; routine gets the bell +
// "Routine". Unread rows get a left accent bar, a dot, and bold weight; read
// rows are muted.
export function NotificationRow({
  id,
  href,
  title,
  body,
  meta,
  severityLabel,
  severityUrgent,
  unread,
  markReadLabel,
  markReadAria,
}: {
  id: string;
  href: string | null;
  title: ReactNode;
  body: ReactNode;
  meta: ReactNode;
  severityLabel: string;
  severityUrgent: boolean;
  unread: boolean;
  markReadLabel: string;
  markReadAria: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Row tap: mark read (best-effort) then navigate. We navigate optimistically
  // so the click always feels instant; the action revalidates the badge/count.
  function openRow() {
    if (unread) {
      const fd = new FormData();
      fd.set("id", id);
      startTransition(() => {
        void markRead(fd);
      });
    }
    if (href) router.push(href);
  }

  function onMarkRead(e: React.MouseEvent) {
    // Stop the row's open handler — this button marks WITHOUT navigating.
    e.stopPropagation();
  }

  const accent = unread
    ? "border-l-4 border-l-accent bg-accent/5"
    : "border-l-4 border-l-transparent";

  return (
    <li>
      <div
        role={href ? "link" : undefined}
        tabIndex={href ? 0 : undefined}
        onClick={openRow}
        onKeyDown={(e) => {
          if (href && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            openRow();
          }
        }}
        aria-busy={isPending || undefined}
        className={`${card} ${accent} flex min-h-[60px] items-start gap-3 px-4 py-3 transition ${
          href ? "cursor-pointer hover:bg-foreground/5" : ""
        }`}
      >
        {/* Severity glyph — icon paired with text below; never colour alone. */}
        <span
          aria-hidden
          className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${
            severityUrgent
              ? "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300"
              : "bg-foreground/5 text-muted"
          }`}
        >
          {severityUrgent ? (
            <WarningIcon className="h-5 w-5" />
          ) : (
            <BellIcon className="h-5 w-5" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={`flex flex-wrap items-center gap-1.5 ${
              unread ? "font-semibold" : "font-medium text-foreground/80"
            }`}
          >
            {unread ? (
              <span
                aria-hidden
                className="inline-block h-2 w-2 shrink-0 rounded-full bg-accent"
              />
            ) : null}
            <span className="min-w-0 break-words">{title}</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                severityUrgent
                  ? "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300"
                  : "bg-foreground/5 text-muted"
              }`}
            >
              {severityUrgent ? (
                <WarningIcon className="h-3 w-3" aria-hidden />
              ) : (
                <BellIcon className="h-3 w-3" aria-hidden />
              )}
              {severityLabel}
            </span>
          </p>
          <p className="mt-0.5 break-words text-sm text-muted">{body}</p>
          <p className="mt-1 text-xs text-muted">{meta}</p>
        </div>

        {/* Per-row mark-read: a real form posting to the server action, so it
            works without JS and never navigates. Hidden once read. */}
        {unread ? (
          <form action={markRead} onClick={onMarkRead} className="shrink-0">
            <input type="hidden" name="id" value={id} />
            <button
              type="submit"
              aria-label={markReadAria}
              title={markReadLabel}
              className="grid h-11 w-11 place-items-center rounded-lg text-muted transition hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className="h-5 w-5"
              >
                <path d="m5 12.5 4.5 4.5L19 7" />
              </svg>
            </button>
          </form>
        ) : null}
      </div>
    </li>
  );
}
