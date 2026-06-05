"use client";

import { useState } from "react";
import { btnGhost } from "@/lib/ui";

// Copies an invite link to the clipboard (we don't auto-send email in the MVP —
// the admin shares the link however they reach the volunteer).
export function CopyButton({
  value,
  label = "Copy invite link",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked (e.g. insecure context) — select-and-copy fallback.
          window.prompt("Copy this invite link:", value);
        }
      }}
      className={`${btnGhost} h-9 px-3 text-sm`}
    >
      {copied ? "✓ Copied" : label}
    </button>
  );
}
