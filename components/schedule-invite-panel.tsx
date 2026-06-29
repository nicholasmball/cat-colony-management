"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { inviteVolunteer } from "@/app/app/members/actions";
import { btnGhost, btnPrimary, fieldLabel, input } from "@/lib/ui";

// Inline "Invite a new volunteer" affordance for the Add-schedule form. Admin
// only (the parent gates rendering on org.role === "admin"; inviteVolunteer
// re-checks server-side). It is a disclosure, NOT a modal: a real
// <button aria-expanded aria-controls> toggles an in-flow panel, so nothing
// covers the viewport or traps focus.
//
// It lives INSIDE the schedule <form> but never participates in it — the email
// is React state (no `name`), and every control is type="button". Sending calls
// the shared inviteVolunteer server action directly (source=schedule +
// colony_id), which validates the role default (feeder) + return path and then
// redirects back here with ?invited=… so the parent renders the confirmation.
//
// `variant="empty"` + `forceExpanded` is the 0-feeders state: always open, no
// collapse toggle, and the helper says the schedule can be created once someone
// accepts.
export function ScheduleInvitePanel({
  colonyId,
  variant = "default",
  forceExpanded = false,
}: {
  colonyId: string;
  variant?: "default" | "empty";
  forceExpanded?: boolean;
}) {
  const t = useTranslations("schedules");
  const [expanded, setExpanded] = useState(forceExpanded);
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const emailRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const emailId = useId();
  const helpId = useId();

  function open() {
    setExpanded(true);
    // Focus the email field once the panel is in the DOM.
    requestAnimationFrame(() => emailRef.current?.focus());
  }

  function collapse() {
    setExpanded(false);
    setEmail("");
    toggleRef.current?.focus();
  }

  function submit() {
    const value = email.trim();
    if (value === "" || pending) return;
    const data = new FormData();
    data.set("email", value);
    data.set("source", "schedule");
    data.set("colony_id", colonyId);
    startTransition(() => {
      // The action redirects on success/error; Next applies it client-side.
      void inviteVolunteer(data);
    });
  }

  const helper =
    variant === "empty" ? t("invite.helperEmpty") : t("invite.helper");

  const panel = (
    <div
      id={panelId}
      role="group"
      aria-label={t("invite.inviteVolunteer")}
      aria-busy={pending}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !forceExpanded) {
          e.preventDefault();
          collapse();
        }
      }}
      className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent/[0.035] p-3.5"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-accent">
        {t("invite.inviteVolunteer")}
      </p>
      <label className={fieldLabel} htmlFor={emailId}>
        <span>{t("invite.emailLabel")}</span>
      </label>
      <input
        ref={emailRef}
        id={emailId}
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={t("invite.emailPlaceholder")}
        aria-describedby={helpId}
        disabled={pending}
        className={input}
      />
      <p id={helpId} className="text-xs text-muted">
        {helper}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || email.trim() === ""}
          aria-busy={pending}
          className={`${btnPrimary} ${forceExpanded ? "w-full sm:w-auto" : ""}`}
        >
          {pending ? t("invite.sending") : t("invite.send")}
        </button>
        {forceExpanded ? null : (
          <button
            type="button"
            onClick={collapse}
            disabled={pending}
            className={btnGhost}
          >
            {t("cancel")}
          </button>
        )}
      </div>
      <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
        {/* Shield icon (not colour-alone, WCAG 1.4.1) — mirrors
            invite-role-select.tsx's admin note. */}
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
    </div>
  );

  // 0-feeders state: no disclosure, always expanded — the invite IS the action.
  if (forceExpanded) return panel;

  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-muted">
        <span>{t("invite.dontSeeThem")}</span>
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => (expanded ? collapse() : open())}
          className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-accent underline underline-offset-2"
        >
          {t("invite.inviteVolunteer")}
          <span aria-hidden="true" className="text-[0.7em]">
            ▾
          </span>
        </button>
      </p>
      {expanded ? panel : null}
    </div>
  );
}
