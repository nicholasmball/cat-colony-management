import { login } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { Logo } from "@/components/logo";
import { btnPrimary, fieldLabel, input } from "@/lib/ui";

// Invite-only: there is no public sign-up. Accounts are created by an
// administrator; this page lets an existing volunteer sign in.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-1 flex-col justify-center gap-8 p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo width={184} />
        <p className="text-sm text-muted">Sign in to your account</p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      <form action={login} className="flex flex-col gap-4">
        <label className={fieldLabel}>
          <span>Email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className={input}
          />
        </label>
        <label className={fieldLabel}>
          <span>Password</span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className={input}
          />
        </label>
        <SubmitButton pendingText="Signing in…" className={btnPrimary}>
          Sign in
        </SubmitButton>
      </form>

      <p className="text-center text-xs text-muted">
        No account? Ask an administrator to invite you.
      </p>
    </main>
  );
}
