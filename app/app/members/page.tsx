import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getActiveOrg } from "@/lib/active-org";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SubmitButton } from "@/components/submit-button";
import { CopyButton } from "@/components/copy-button";
import { ConfirmButton } from "@/components/confirm-button";
import { RoleSelectForm } from "@/components/role-select-form";
import { type AppRole } from "@/lib/member-role";
import {
  btnGhost,
  btnGhostDanger,
  btnPrimary,
  card,
  fieldLabel,
  input,
  pill,
} from "@/lib/ui";
import {
  inviteVolunteer,
  resendInvite,
  revokeInvite,
  deactivateMember,
  reactivateMember,
  updateMemberRole,
} from "./actions";

type Member = { user_id: string; role: string; deleted_at: string | null };
type Invite = { id: string; email: string; role: string; token: string };

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";
const okClass =
  "rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    invited?: string;
    sent?: string;
    updated?: string;
    role?: string;
  }>;
}) {
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  if (org.role !== "admin") redirect("/app"); // admin-only screen

  const t = await getTranslations("members");
  const {
    error,
    invited,
    sent,
    updated,
    role: updatedRole,
  } = await searchParams;

  // The viewer's id — used to mark their own row (no self role change).
  const supabase = await createClient();
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();

  // Admin-only reads via the service client (caller already verified admin).
  const svc = createServiceClient();
  const [{ data: memberRows }, { data: inviteRows }] = await Promise.all([
    svc
      .from("memberships")
      .select("user_id, role, deleted_at")
      .eq("organisation_id", org.organisation_id)
      .order("created_at", { ascending: true }),
    svc
      .from("invitations")
      .select("id, email, role, token")
      .eq("organisation_id", org.organisation_id)
      .is("accepted_at", null)
      .order("created_at", { ascending: true }),
  ]);

  const members = (memberRows ?? []) as Member[];
  const invites = (inviteRows ?? []) as Invite[];

  // Active-admin count drives the last-admin UI guard (server re-checks anyway).
  const activeAdminCount = members.filter(
    (m) => !m.deleted_at && m.role === "admin",
  ).length;

  // Look up each member's email (the only personal data we hold).
  const emails = new Map<string, string>();
  await Promise.all(
    members.map(async (m) => {
      const { data } = await svc.auth.admin.getUserById(m.user_id);
      emails.set(m.user_id, data.user?.email ?? t("memberFallback"));
    }),
  );

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;

  return (
    <div className="flex max-w-2xl flex-col gap-6 px-6 py-6 md:px-10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="text-sm text-muted">{org.name}</p>
        </div>
      </div>

      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
      {invited ? (
        <p className={okClass}>
          {t.rich("invitedToast", {
            email: invited,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
          {sent === "1" ? t("invitedEmailed") : t("invitedCopyLink")}
        </p>
      ) : null}
      {updated ? (
        <p role="status" className={okClass}>
          {t.rich("updatedToast", {
            name: emails.get(updated) ?? t("memberFallback"),
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
          {updatedRole
            ? t("updatedToRole", { role: t(`role.${updatedRole}`) })
            : "."}
        </p>
      ) : null}

      {/* Invite form */}
      <form
        action={inviteVolunteer}
        className={`${card} flex flex-col gap-3 p-4`}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t("inviteHeading")}
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className={`${fieldLabel} flex-1`}>
            <span>{t("emailLabel")}</span>
            <input
              name="email"
              type="email"
              required
              placeholder={t("emailPlaceholder")}
              className={input}
            />
          </label>
          <label className={`${fieldLabel} sm:w-44`}>
            <span>{t("roleLabel")}</span>
            <select name="role" defaultValue="feeder" className={input}>
              <option value="feeder">{t("role.feeder")}</option>
              <option value="caretaker">{t("role.caretaker")}</option>
            </select>
          </label>
        </div>
        <SubmitButton
          pendingText={t("inviting")}
          className={`${btnPrimary} self-start`}
        >
          {t("sendInvite")}
        </SubmitButton>
      </form>

      {/* Team */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t("teamHeading", {
            count: members.filter((m) => !m.deleted_at).length,
          })}
        </h2>
        <ul className="flex flex-col gap-2">
          {members.map((m) => {
            const inactive = !!m.deleted_at;
            const isSelf = !!viewer && m.user_id === viewer.id;
            // Active, not-own rows get the inline role editor. Own row and
            // deactivated rows keep a static pill (no role control).
            const editable = !inactive && !isSelf;
            const isLastAdmin = m.role === "admin" && activeAdminCount <= 1;
            return (
              <li
                key={m.user_id}
                className={`${card} flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${
                  inactive ? "opacity-60" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {emails.get(m.user_id)}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                    {editable ? null : (
                      <span className={pill}>{t(`role.${m.role}`)}</span>
                    )}
                    {isSelf ? <span className={pill}>{t("you")}</span> : null}
                    <span className="text-muted">
                      {inactive ? t("deactivatedLabel") : t("activeLabel")}
                    </span>
                    {isSelf && !inactive ? (
                      <span className="text-muted">
                        {t("cantChangeOwnRole")}
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {editable ? (
                    <RoleSelectForm
                      action={updateMemberRole}
                      userId={m.user_id}
                      email={emails.get(m.user_id) ?? t("thisMember")}
                      currentRole={m.role as AppRole}
                      isLastAdmin={isLastAdmin}
                    />
                  ) : null}
                  {inactive ? (
                    <form action={reactivateMember}>
                      <input type="hidden" name="user_id" value={m.user_id} />
                      <SubmitButton
                        pendingText="…"
                        className={`${btnGhost} h-9 px-3 text-sm`}
                      >
                        {t("reactivate")}
                      </SubmitButton>
                    </form>
                  ) : isSelf ? null : (
                    <form action={deactivateMember}>
                      <input type="hidden" name="user_id" value={m.user_id} />
                      <ConfirmButton
                        confirm={t("deactivateConfirm", {
                          email: emails.get(m.user_id) ?? t("thisMember"),
                        })}
                        className={`${btnGhostDanger} h-9 px-3 text-sm`}
                      >
                        {t("deactivate")}
                      </ConfirmButton>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Pending invites */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t("pendingInvites")} ({invites.length})
        </h2>
        {invites.length === 0 ? (
          <p className={`${card} p-4 text-sm text-muted`}>
            {t("noPendingInvites")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {invites.map((inv) => (
              <li
                key={inv.id}
                className={`${card} flex flex-wrap items-center justify-between gap-2 px-4 py-3`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{inv.email}</p>
                  <p className="mt-0.5 text-xs">
                    <span className={pill}>{t(`role.${inv.role}`)}</span>{" "}
                    <span className="text-muted">{t("pendingSuffix")}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <CopyButton value={`${origin}/accept?token=${inv.token}`} />
                  <form action={resendInvite}>
                    <input type="hidden" name="email" value={inv.email} />
                    <SubmitButton
                      pendingText="…"
                      className={`${btnGhost} h-9 px-3 text-sm`}
                    >
                      {t("resendEmail")}
                    </SubmitButton>
                  </form>
                  <form action={revokeInvite}>
                    <input type="hidden" name="invite_id" value={inv.id} />
                    <ConfirmButton
                      confirm={t("revokeInviteConfirm", { email: inv.email })}
                      className={`${btnGhostDanger} h-9 px-3 text-sm`}
                    >
                      {t("revoke")}
                    </ConfirmButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-muted">{t("invitesHint")}</p>
      </section>
    </div>
  );
}
