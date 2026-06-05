"use client";

import { useFormStatus } from "react-dom";

// Submit button for a server-action form that asks for confirmation first.
// Used for destructive actions (revoke invite, deactivate member).
export function ConfirmButton({
  children,
  confirm,
  className,
}: {
  children: React.ReactNode;
  confirm: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
      className={`${className ?? ""} disabled:opacity-60`}
    >
      {pending ? "…" : children}
    </button>
  );
}
