"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { btnGhostDanger, btnPrimary, input } from "@/lib/ui";
import { ROLE_RANK, type AppRole } from "@/lib/member-role";

const ROLES: AppRole[] = ["admin", "caretaker", "feeder"];

// Inline role editor for one active member row. The server action does all the
// real enforcement (lib/member-role.ts); this wrapper is UX only:
//   - routes any privilege drop (demotion) through ConfirmButton with honest
//     copy, while promotions / no-ops submit directly,
//   - if this is the sole active admin, disables the demote-away options with
//     an adjacent screen-reader explanation (server still guards it regardless).
// Save is always rendered, so the form posts identically with or without JS.
export function RoleSelectForm({
  action,
  userId,
  email,
  currentRole,
  isLastAdmin,
}: {
  action: (formData: FormData) => void;
  userId: string;
  email: string;
  currentRole: AppRole;
  isLastAdmin: boolean;
}) {
  // Tracks the live selection so Save can switch between a direct submit
  // (promote / no-op) and a confirm-first submit (demote). Save is always
  // visible, so the form works identically with or without JS — the
  // reveal-on-change flourish from the design is intentionally skipped to keep
  // this a single, dependency-light client wrapper.
  const t = useTranslations("members");
  const [selected, setSelected] = useState<AppRole>(currentRole);
  const isDemote = ROLE_RANK[selected] < ROLE_RANK[currentRole];
  const hintId = `role-hint-${userId}`;
  // Translated, capitalised role name per enum value.
  const roleName = (r: AppRole) => t(`role.${r}`);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <label htmlFor={`role-${userId}`} className="sr-only">
        {t("roleFor", { email })}
      </label>
      <select
        id={`role-${userId}`}
        name="role"
        value={selected}
        onChange={(e) => setSelected(e.target.value as AppRole)}
        aria-describedby={isLastAdmin ? hintId : undefined}
        className={`${input} h-11 pr-8 text-sm font-medium`}
      >
        {ROLES.map((r) => {
          // Sole active admin: can't move away from admin until another exists.
          const blocked =
            isLastAdmin && currentRole === "admin" && r !== "admin";
          return (
            <option key={r} value={r} disabled={blocked}>
              {blocked
                ? t("roleBlockedOption", { role: roleName(r) })
                : roleName(r)}
            </option>
          );
        })}
      </select>

      {/* Demote → confirm first; promote / no-op → direct submit. Always
          visible so the form posts fine without JS; the server action treats an
          unchanged role as a clean no-op. */}
      {isDemote ? (
        <ConfirmButton
          confirm={t("demoteConfirm", {
            email,
            from: roleName(currentRole),
            to: roleName(selected),
          })}
          className={`${btnGhostDanger} h-9 px-3 text-sm`}
        >
          {t("save")}
        </ConfirmButton>
      ) : (
        <SubmitButton
          pendingText="…"
          className={`${btnPrimary} h-9 px-3 text-sm`}
        >
          {t("save")}
        </SubmitButton>
      )}

      {isLastAdmin && currentRole === "admin" ? (
        <span id={hintId} className="sr-only">
          {t("lastAdminHint")}
        </span>
      ) : null}
    </form>
  );
}
