import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

// Authenticated app shell: top bar + mobile-first bottom navigation.
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
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <Link href="/app" className="font-semibold tracking-tight">
          SCoT
        </Link>
        <div className="flex items-center gap-3 text-xs">
          <span className="max-w-[10rem] truncate text-zinc-500">
            {user.email}
          </span>
          <form action={signOut}>
            <button
              type="submit"
              className="min-h-9 rounded-md border border-zinc-300 px-2 dark:border-zinc-700"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1 pb-20">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-2 border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
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
      className="flex min-h-14 items-center justify-center text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
    >
      {label}
    </Link>
  );
}
