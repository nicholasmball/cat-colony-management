"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ComponentType, SVGProps } from "react";
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
} from "./icons";
import { navItemsFor } from "@/lib/nav-items";
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

  if (variant === "sidebar") {
    return (
      <nav className="flex flex-col gap-1 px-3">
        {items.map(({ href, label, Icon, exact, badge: itemBadge }) => {
          const on = isActive(href, exact);
          return (
            <Link
              key={href}
              href={href}
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

  // Mobile bottom tab bar
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 grid border-t border-border bg-surface md:hidden"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map(({ href, label, Icon, exact, badge: itemBadge }) => {
        const on = isActive(href, exact);
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? "page" : undefined}
            className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium transition ${
              on ? "text-accent" : "text-muted hover:text-foreground"
            }`}
          >
            <span className="relative">
              <Icon className="h-5 w-5" />
              {itemBadge ? (
                <span
                  aria-label={badgeAria}
                  className="absolute -right-2.5 -top-2 grid min-w-[1.1rem] place-items-center rounded-full bg-red-600 px-1 text-[0.65rem] font-bold leading-4 text-white"
                >
                  {itemBadge}
                </span>
              ) : null}
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
