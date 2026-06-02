"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HomeIcon, PawIcon } from "./icons";

const items = [
  { href: "/app", label: "Home", Icon: HomeIcon, exact: true },
  { href: "/app/colonies", label: "Colonies", Icon: PawIcon, exact: false },
];

export function AppNav({ variant }: { variant: "sidebar" | "tabbar" }) {
  const path = usePathname();
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
    <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-2 border-t border-border bg-surface md:hidden">
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
