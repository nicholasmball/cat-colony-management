"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import {
  HomeIcon,
  GridIcon,
  PawIcon,
  UsersIcon,
  CogIcon,
  CalendarIcon,
  WarningIcon,
} from "./icons";
import { navItemsFor } from "@/lib/nav-items";

// Icons can't live in the pure nav-items lib, so map each item's href to its
// Icon here. The which-items decision lives in navItemsFor.
const iconByHref: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  "/app": HomeIcon,
  "/app/dashboard": GridIcon,
  "/app/today": CalendarIcon,
  "/app/colonies": PawIcon,
  "/app/incidents": WarningIcon,
  "/app/members": UsersIcon,
  "/app/org": CogIcon,
};

export function AppNav({
  variant,
  role,
}: {
  variant: "sidebar" | "tabbar";
  role?: string | null;
}) {
  const path = usePathname();
  const items = navItemsFor({ role }).map((item) => ({
    ...item,
    Icon: iconByHref[item.href],
  }));
  const isActive = (href: string, exact: boolean) =>
    exact ? path === href : path.startsWith(href);

  if (variant === "sidebar") {
    return (
      <nav className="flex flex-col gap-1 px-3">
        {items.map(({ href, label, Icon, exact }) => {
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
              {label}
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
      {items.map(({ href, label, Icon, exact }) => {
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
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
