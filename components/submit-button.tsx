"use client";

import { useFormStatus } from "react-dom";

// Disables itself and shows progress while the form's server action runs,
// so a slow round-trip can't be double-submitted.
export function SubmitButton({
  children,
  pendingText,
  className,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}
