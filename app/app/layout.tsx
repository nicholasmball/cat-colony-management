import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/logo";
import { signOut } from "./actions";

// Authenticated app shell: branded top bar + mobile-first bottom navigation.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface/90 px-4 py-2.5 backdrop-blur">
        <Link href="/app" aria-label="Home">
          <Logo width={104} />
        </Link>
        <div className="flex items-center gap-3 text-xs">
          <span className="max-w-[9rem] truncate text-muted">{user.email}</span>
          <form action={signOut}>
            <button
              type="submit"
              className="min-h-9 rounded-lg border border-border px-2.5 text-foreground transition hover:bg-foreground/5"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1 pb-20">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-2 border-t border-border bg-surface">
        <NavLink href="/app" label="Home" />
        <NavLink href="/app/colonies" label="Colonies" />
      </nav>
    </div>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-14 items-center justify-center text-sm font-medium text-muted transition hover:bg-foreground/5 hover:text-foreground"
    >
      {label}
    </Link>
  );
}
