import Link from "next/link";
import type { ReactNode } from "react";
import { btnPrimary, card } from "@/lib/ui";

// Shared empty-state block: a round icon, a bold one-liner, a muted explainer,
// and an OPTIONAL primary CTA. Roles that can't act simply get no `cta` — we
// never render a disabled button. Reused by every primary list.
export function EmptyState({
  icon,
  title,
  body,
  cta,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className={`${card} flex flex-col items-center gap-2 px-6 py-10 text-center`}>
      <span
        aria-hidden
        className="grid h-14 w-14 place-items-center rounded-full bg-accent/10 text-accent"
      >
        {icon}
      </span>
      <p className="font-medium">{title}</p>
      <p className="max-w-xs text-sm text-muted">{body}</p>
      {cta ? (
        <Link href={cta.href} className={`${btnPrimary} mt-2 text-sm`}>
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
