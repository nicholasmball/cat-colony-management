"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { SubmitButton } from "@/components/submit-button";
import { transitionIncident } from "@/app/app/incidents/actions";
import { btnGhost, btnPrimary, input } from "@/lib/ui";

// "Mark resolved…" expands an inline required-note box in place (no modal) — the
// "deliberate but not hostile" resolve flow from the design. The note is
// required: the server (transitionIncident) re-checks and rejects empty, but we
// also block client-side and keep focus in the field for a fast, accessible
// correction. Server-side validation stays the real guard.
export function IncidentResolveForm({ incidentId }: { incidentId: string }) {
  const t = useTranslations("incidents");
  const tErr = useTranslations("errors");
  const [open, setOpen] = useState(false);
  const [touchedEmpty, setTouchedEmpty] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${btnPrimary} min-h-11 text-sm`}
      >
        {t("resolve.markResolved")}
      </button>
    );
  }

  return (
    <form
      action={transitionIncident}
      onSubmit={(e) => {
        if (!noteRef.current?.value.trim()) {
          e.preventDefault();
          setTouchedEmpty(true);
          noteRef.current?.focus();
        }
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="incident_id" value={incidentId} />
      <input type="hidden" name="status" value="resolved" />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        <span>
          {t("resolve.resolutionNote")} <span className="text-red-600">*</span>
        </span>
        <textarea
          ref={noteRef}
          name="resolution_note"
          rows={3}
          required
          aria-invalid={touchedEmpty}
          aria-describedby={touchedEmpty ? "resolve-error" : undefined}
          onChange={() => touchedEmpty && setTouchedEmpty(false)}
          placeholder={t("resolve.resolutionPlaceholder")}
          className={`${input} py-2 ${
            touchedEmpty ? "border-red-600 ring-2 ring-red-600/25" : ""
          }`}
        />
      </label>
      {touchedEmpty ? (
        <p
          id="resolve-error"
          role="alert"
          className="text-sm font-medium text-red-700"
        >
          {tErr("resolveNoteRequired")}
        </p>
      ) : (
        <p className="text-xs text-muted">{t("resolve.noteHint")}</p>
      )}
      <div className="flex items-center gap-2">
        <SubmitButton
          pendingText={t("resolve.resolving")}
          className={`${btnPrimary} min-h-11 text-sm`}
        >
          {t("resolve.confirmResolve")}
        </SubmitButton>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTouchedEmpty(false);
          }}
          className={`${btnGhost} min-h-11 text-sm`}
        >
          {t("resolve.cancel")}
        </button>
      </div>
    </form>
  );
}
