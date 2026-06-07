"use client";

import { useFormStatus } from "react-dom";
import { shouldBlockSubmit } from "@/lib/confirm";

// Submit button for a server-action form that asks for confirmation first.
// Used for destructive actions (revoke invite, deactivate member).
export function ConfirmButton({
  children,
  confirm,
  className,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  confirm: string;
  className?: string;
  "aria-label"?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={ariaLabel}
      onClick={(e) => {
        if (shouldBlockSubmit(window.confirm(confirm))) e.preventDefault();
      }}
      className={`${className ?? ""} disabled:opacity-60`}
    >
      {pending ? "…" : children}
    </button>
  );
}
