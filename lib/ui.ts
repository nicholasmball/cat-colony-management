// Shared UI class tokens — the design-system primitives. Keeps every screen
// visually consistent without a heavy component layer.

export const btnPrimary =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 font-medium text-accent-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

export const btnGhost =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 font-medium text-foreground transition hover:bg-foreground/5";

// Ghost button in a destructive/danger tone. Same shape as btnGhost (so a
// Delete sits flush next to an Edit) — only the colour differs.
export const btnGhostDanger =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 px-4 font-medium text-red-700 transition hover:bg-red-50 dark:border-red-900 dark:text-red-300";

// Solid destructive button — for the confirm action in a danger dialog.
export const btnDanger =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-red-600 px-4 font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60";

export const card = "rounded-xl border border-border bg-surface";

export const input =
  "min-h-11 rounded-lg border border-border bg-surface px-3 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25";

export const fieldLabel = "flex flex-col gap-1.5 text-sm font-medium";

export const pill =
  "rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent";
