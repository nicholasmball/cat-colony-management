"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type ComponentType, type SVGProps } from "react";
import {
  HomeIcon,
  GridIcon,
  PawIcon,
  UsersIcon,
  CogIcon,
  CalendarIcon,
  WarningIcon,
  BellIcon,
  SlidersIcon,
  HelpIcon,
  MegaphoneIcon,
  EllipsisIcon,
} from "./icons";
import { navItemsFor, splitNavForTabbar } from "@/lib/nav-items";
import { unreadBadge } from "@/lib/notifications";

// Icons can't live in the pure nav-items lib, so map each item's href to its
// Icon here. The which-items decision lives in navItemsFor.
const iconByHref: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  "/app": HomeIcon,
  "/app/dashboard": GridIcon,
  "/app/today": CalendarIcon,
  "/app/colonies": PawIcon,
  "/app/incidents": WarningIcon,
  "/app/notifications": BellIcon,
  "/app/alerts": SlidersIcon,
  "/app/members": UsersIcon,
  "/app/org": CogIcon,
  "/app/help": HelpIcon,
  "/app/feedback": MegaphoneIcon,
};

// The single nav item that carries the unread-notifications badge.
const BADGE_HREF = "/app/notifications";

export function AppNav({
  variant,
  role,
  unreadCount = 0,
}: {
  variant: "sidebar" | "tabbar";
  role?: string | null;
  unreadCount?: number;
}) {
  const path = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  // nav-items is pure and carries i18n keys; translate them here. The keys are
  // already namespaced ("nav.dashboard"), so use the root translator.
  const t = useTranslations();
  // Pure helper decides the pill text: null (hidden) at 0, "1".."9", "9+".
  const badge = unreadBadge(unreadCount);
  const badgeAria = t("notifications.unreadBadgeAria", { count: unreadCount });
  const items = navItemsFor({ role }).map((item) => ({
    ...item,
    label: t(item.labelKey),
    Icon: iconByHref[item.href],
    badge: item.href === BADGE_HREF ? badge : null,
  }));
  const isActive = (href: string, exact: boolean) =>
    exact ? path === href : path.startsWith(href);
  // The Feedback link carries the route the user is currently on as ?from=…, so
  // the report records which screen they were looking at (SPA nav leaves
  // document.referrer blank). Active-state checks still use the clean href.
  const linkHref = (href: string) =>
    href === "/app/feedback" && path && !path.startsWith("/app/feedback")
      ? `${href}?from=${encodeURIComponent(path)}`
      : href;

  if (variant === "sidebar") {
    return (
      <nav className="flex flex-col gap-1 px-3">
        {items.map(({ href, label, Icon, exact, badge: itemBadge }) => {
          const on = isActive(href, exact);
          return (
            <Link
              key={href}
              href={linkHref(href)}
              aria-current={on ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                on
                  ? "bg-accent/10 text-accent"
                  : "text-foreground/80 hover:bg-foreground/5"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="flex-1">{label}</span>
              {itemBadge ? (
                <span
                  aria-label={badgeAria}
                  className="grid min-w-[1.25rem] place-items-center rounded-full bg-red-600 px-1.5 text-xs font-bold leading-5 text-white"
                >
                  {itemBadge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    );
  }

  // Mobile bottom tab bar. The bar only fits ~5 cells before labels collide
  // (admins have 8 items), so the extras collapse into a "More" sheet.
  const { visible, overflow } = splitNavForTabbar(items);
  const overflowActive = overflow.some((i) => isActive(i.href, i.exact));
  // Keep the unread badge visible even when Notifications is in the overflow:
  // surface it on the "More" entry.
  const overflowBadge = overflow.some((i) => i.href === BADGE_HREF)
    ? badge
    : null;
  const cellCount = visible.length + (overflow.length ? 1 : 0);
  const dotBadge =
    "absolute -right-2.5 -top-2 grid min-w-[1.1rem] place-items-center rounded-full bg-red-600 px-1 text-[0.65rem] font-bold leading-4 text-white";

  return (
    <>
      {moreOpen && overflow.length ? (
        <>
          <button
            type="button"
            aria-label={t("nav.closeMenu")}
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-30 bg-black/30 md:hidden"
          />
          <div
            role="menu"
            aria-label={t("nav.more")}
            className="fixed inset-x-0 bottom-16 z-40 flex flex-col gap-1 border-t border-border bg-surface p-2 md:hidden"
          >
            {overflow.map(({ href, label, Icon, exact, badge: itemBadge }) => {
              const on = isActive(href, exact);
              return (
                <Link
                  key={href}
                  href={linkHref(href)}
                  role="menuitem"
                  aria-current={on ? "page" : undefined}
                  onClick={() => setMoreOpen(false)}
                  className={`flex min-h-12 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    on
                      ? "bg-accent/10 text-accent"
                      : "text-foreground/80 hover:bg-foreground/5"
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="flex-1">{label}</span>
                  {itemBadge ? (
                    <span
                      aria-label={badgeAria}
                      className="grid min-w-[1.25rem] place-items-center rounded-full bg-red-600 px-1.5 text-xs font-bold leading-5 text-white"
                    >
                      {itemBadge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </>
      ) : null}

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid border-t border-border bg-surface md:hidden"
        style={{ gridTemplateColumns: `repeat(${cellCount}, minmax(0, 1fr))` }}
      >
        {visible.map(({ href, label, Icon, exact, badge: itemBadge }) => {
          const on = isActive(href, exact);
          return (
            <Link
              key={href}
              href={linkHref(href)}
              aria-current={on ? "page" : undefined}
              onClick={() => setMoreOpen(false)}
              className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-center text-xs font-medium transition ${
                on ? "text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {itemBadge ? (
                  <span aria-label={badgeAria} className={dotBadge}>
                    {itemBadge}
                  </span>
                ) : null}
              </span>
              {label}
            </Link>
          );
        })}
        {overflow.length ? (
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-current={overflowActive ? "page" : undefined}
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-center text-xs font-medium transition ${
              moreOpen || overflowActive
                ? "text-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            <span className="relative">
              <EllipsisIcon className="h-5 w-5" />
              {overflowBadge ? (
                <span aria-label={badgeAria} className={dotBadge}>
                  {overflowBadge}
                </span>
              ) : null}
            </span>
            {t("nav.more")}
          </button>
        ) : null}
      </nav>
    </>
  );
}
