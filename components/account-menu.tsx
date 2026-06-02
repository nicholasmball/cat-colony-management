import { signOut } from "@/app/app/actions";

// Mobile account menu: avatar → email + sign out. Uses a native <details> so it
// needs no client JS and stays keyboard-accessible.
export function AccountMenu({ email }: { email: string }) {
  const initial = (email[0] ?? "?").toUpperCase();
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
          {initial}
        </span>
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-border bg-surface p-2 shadow-lg shadow-black/5">
        <p className="truncate px-2 py-1.5 text-xs text-muted" title={email}>
          {email}
        </p>
        <form action={signOut}>
          <button
            type="submit"
            className="w-full rounded-lg px-2 py-2 text-left text-sm text-foreground transition hover:bg-foreground/5"
          >
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
