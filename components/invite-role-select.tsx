"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { fieldLabel, input } from "@/lib/ui";

// The role <select> for the invite form, plus an inline "full access" note that
// reveals ONLY when Admin is selected. Mirrors the reveal idiom in
// role-select-form.tsx (client useState + aria-describedby). The server action
// is the real security boundary (it validates via isRole) — this note is purely
// to inform the inviting admin. Renders inside the existing invite <form>, so it
// must not touch the form's action, email field or submit button.
//
// Order is Feeder → Caretaker → Admin (low-to-high privilege), default Feeder.
// Without JS the note never shows, but the select still posts a valid role.
export function InviteRoleSelect() {
  const t = useTranslations("members");
  const [role, setRole] = useState("feeder");
  const isAdmin = role === "admin";

  return (
    <div className="flex flex-col gap-3 sm:w-44">
      <label className={fieldLabel}>
        <span>{t("roleLabel")}</span>
        <select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          aria-describedby={isAdmin ? "invite-admin-note" : undefined}
          className={input}
        >
          <option value="feeder">{t("role.feeder")}</option>
          <option value="caretaker">{t("role.caretaker")}</option>
          <option value="admin">{t("role.admin")}</option>
        </select>
      </label>

      {isAdmin ? (
        <p
          id="invite-admin-note"
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
        >
          {/* Icon marker (not colour-alone, WCAG 1.4.1): a shield paired with
              the text so meaning never depends on the amber tint. */}
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="mt-0.5 h-4 w-4 flex-none"
          >
            <path
              fillRule="evenodd"
              d="M10 1.5 3.5 4v5c0 4.06 2.77 7.86 6.5 9 3.73-1.14 6.5-4.94 6.5-9V4L10 1.5Zm-.75 11.62L6.5 10.37l1.06-1.06 1.69 1.69 3.19-3.19 1.06 1.06-4.25 4.25Z"
              clipRule="evenodd"
            />
          </svg>
          <span>{t("invite.adminNote")}</span>
        </p>
      ) : null}
    </div>
  );
}
