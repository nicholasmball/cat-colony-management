"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { btnDanger, btnGhost, card } from "@/lib/ui";

// Submit button for a server-action form that asks for confirmation first via
// an in-app styled dialog (replaces the browser-native window.confirm).
// Used for destructive actions (delete schedule, deactivate member, demote a role…).
// The confirm button is a real type="submit" rendered inside the parent form,
// so confirming submits the form / runs the server action.
export function ConfirmButton({
  children,
  confirm,
  className,
  confirmLabel = "Confirm",
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  confirm: string;
  className?: string;
  confirmLabel?: string;
  "aria-label"?: string;
}) {
  const { pending } = useFormStatus();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();

  // On open: lock body scroll and move focus to the (safe) Cancel button.
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Once the form is submitting, the page revalidates/redirects; keep the
  // dialog up but reflect the pending state on the confirm button.

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key !== "Tab") return;
    // Minimal focus trap across the dialog's focusable controls.
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled])",
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={className ?? ""}
      >
        {children}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onMouseDown={(e) => {
            // Click on the backdrop (not the dialog) cancels.
            if (e.target === e.currentTarget) setOpen(false);
          }}
          onKeyDown={onKeyDown}
        >
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={labelId}
            className={`${card} w-full max-w-sm p-5 shadow-lg`}
          >
            <p id={labelId} className="text-sm text-foreground">
              {confirm}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className={`${btnGhost} px-3 text-sm`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className={`${btnDanger} px-3 text-sm`}
              >
                {pending ? "…" : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
