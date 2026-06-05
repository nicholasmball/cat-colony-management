import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { Logo } from "@/components/logo";
import { SubmitButton } from "@/components/submit-button";
import { btnPrimary, card, fieldLabel, input } from "@/lib/ui";
import { completeAccept } from "./actions";

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo width={150} />
        </div>
        <div className={`${card} flex flex-col gap-4 p-6`}>{children}</div>
      </div>
    </main>
  );
}

type Invite = {
  email: string;
  role: string;
  token: string;
  accepted_at: string | null;
  organisations: { name: string } | { name: string }[] | null;
};

export default async function AcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const svc = createServiceClient();

  // Find the invite either by ?token (copy-link path) or by the signed-in
  // account's email (email-link path).
  let inv: Invite | null = null;
  if (token) {
    const { data } = await svc
      .from("invitations")
      .select("email, role, token, accepted_at, organisations(name)")
      .eq("token", token)
      .maybeSingle();
    inv = (data as Invite) ?? null;
  } else if (user?.email) {
    const { data } = await svc
      .from("invitations")
      .select("email, role, token, accepted_at, organisations(name)")
      .ilike("email", user.email)
      .is("accepted_at", null)
      .limit(1)
      .maybeSingle();
    inv = (data as Invite) ?? null;
  }

  const orgRel = inv?.organisations;
  const orgName =
    (Array.isArray(orgRel) ? orgRel[0]?.name : orgRel?.name) ??
    "the organisation";

  if (!inv || inv.accepted_at) {
    return (
      <Shell>
        <h1 className="font-display text-2xl">Invite not available</h1>
        <p className="text-sm text-muted">
          {user
            ? "There’s no pending invite for your account. If you already joined, just open the app."
            : "This invite link is missing, invalid, or already used. Ask whoever invited you to send it again."}
        </p>
        <Link href={user ? "/app" : "/login"} className={`${btnPrimary} justify-center`}>
          {user ? "Open the app" : "Go to sign in"}
        </Link>
      </Shell>
    );
  }

  // Signed in as a different account than the invite is for.
  if (user && user.email?.toLowerCase() !== inv.email.toLowerCase()) {
    return (
      <Shell>
        <h1 className="font-display text-2xl">Wrong account</h1>
        <p className="text-sm text-muted">
          This invite is for <strong>{inv.email}</strong>, but you’re signed in as{" "}
          <strong>{user.email}</strong>. Sign out, then open the link again.
        </p>
        <Link href="/login" className="text-sm text-accent">
          Go to sign in
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="font-display text-2xl">Welcome to {orgName} 🐾</h1>
      <p className="text-sm text-muted">
        You’ve been invited as a <strong>{inv.role}</strong> ({inv.email}). Choose
        a password to set up your account.
      </p>

      {error ? <p className={errorClass}>{error}</p> : null}

      <form action={completeAccept} className="flex flex-col gap-3">
        {token ? <input type="hidden" name="token" value={token} /> : null}
        <label className={fieldLabel}>
          <span>Password</span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={input}
          />
        </label>
        <label className={fieldLabel}>
          <span>Confirm password</span>
          <input
            name="confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={input}
          />
        </label>
        <p className="-mt-1 text-xs text-muted">At least 8 characters.</p>
        <SubmitButton pendingText="Setting up…" className={`${btnPrimary} w-full`}>
          Set password &amp; join
        </SubmitButton>
      </form>
    </Shell>
  );
}
