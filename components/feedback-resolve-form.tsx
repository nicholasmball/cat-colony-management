"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { resolveFeedback } from "@/app/app/feedback/inbox/actions";
import { btnGhost, btnPrimary, input } from "@/lib/ui";
import { RESOLUTION_NOTE_MAX } from "@/lib/feedback-resolve";

// The admin "Resolve" affordance for one inbox row. Mirrors the inline-confirm
// pattern of components/incident-resolve-form.tsx — a Resolve button expands an
// in-place confirm (NO modal, so it stays usable on a 375px phone) — but the
// note here is OPTIONAL (incidents require it). On success the server action
// revalidates the inbox, so this row re-renders into its terminal Resolved
// state and this form unmounts; on failure the panel stays open with the error.
export function FeedbackResolveForm({ feedbackId }: { feedbackId: string }) {
  const t = useTranslations("feedback.inbox.resolve");
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const noteId = useId();
  const counterId = useId();
  const cueId = useId();
  const errorId = useId();

  if (!open) {
    return (
      <div className="mt-3 flex border-t border-border pt-3">
        <button
          type="button"
          aria-expanded={false}
          onClick={() => {
            setOpen(true);
            // Focus moves into the note as the panel opens (in-flow, no trap).
            requestAnimationFrame(() => noteRef.current?.focus());
          }}
          className={`${btnPrimary} w-full text-sm sm:w-auto`}
        >
          <span aria-hidden="true">✓</span> {t("resolve")}
        </button>
      </div>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await resolveFeedback({ feedbackId, note });
      if (!res.ok) {
        setError(res.error);
        noteRef.current?.focus();
        return;
      }
      // Success: revalidation swaps this row to its Resolved state and unmounts
      // the form. Collapse defensively in case the row is reused.
      setOpen(false);
      setNote("");
    });
  }

  const atLimit = note.length >= RESOLUTION_NOTE_MAX;
  const describedBy = `${counterId} ${cueId}${error ? ` ${errorId}` : ""}`;

  return (
    <div
      role="group"
      aria-label={t("groupLabel")}
      aria-busy={isPending || undefined}
      className="mt-3 flex flex-col gap-2 rounded-lg border border-accent/30 bg-accent/[0.03] p-3"
    >
      <label htmlFor={noteId} className="text-sm font-medium">
        {t("resolutionNote")}{" "}
        <span className="font-normal text-muted">{t("optional")}</span>
      </label>
      <textarea
        id={noteId}
        ref={noteRef}
        name="resolution_note"
        rows={3}
        maxLength={RESOLUTION_NOTE_MAX}
        disabled={isPending}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          if (error) setError(null);
        }}
        aria-describedby={describedBy}
        placeholder={t("notePlaceholder")}
        className={`${input} w-full resize-y py-2`}
      />
      <span
        id={counterId}
        aria-live="polite"
        className={`self-end text-xs tabular-nums ${
          atLimit ? "font-bold text-red-700 dark:text-red-300" : "text-muted"
        }`}
      >
        {t("counter", { count: note.length })}
      </span>
      {/* Terminality cue — Resolve has no Reopen in v1. Glyph + text, not colour-alone. */}
      <p
        id={cueId}
        className="flex items-baseline gap-1.5 text-xs text-amber-800 dark:text-amber-300"
      >
        <span aria-hidden="true">⚠</span>
        <span className="font-semibold">{t("terminalCue")}</span>
      </p>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-sm font-medium text-red-700"
        >
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted">{t("noteHint")}</p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          aria-busy={isPending || undefined}
          className={`${btnPrimary} text-sm`}
        >
          {isPending ? (
            t("resolving")
          ) : (
            <>
              <span aria-hidden="true">✓</span> {t("confirmResolve")}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={isPending}
          className={`${btnGhost} text-sm`}
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
