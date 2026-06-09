"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getStore, onOutboxChange, runFlush } from "@/lib/offline/client";
import { list, markPendingRetry } from "@/lib/offline/outbox";
import {
  countStates,
  summariseQueue,
  hasQueueActivity,
  isRetryable,
  stateLabelKey,
  kindLabelKey,
  type QueueTone,
} from "@/lib/offline/summary";
import { PENDING_REASON_NETWORK } from "@/lib/offline/sync";
import type { OutboxItem } from "@/lib/offline/types";
import { relativeTime } from "@/lib/relative-time";
import { EmptyState } from "@/components/empty-state";
import { ChevronIcon } from "@/components/icons";

// How often to re-read the queue while the panel is idle. Cheap (a single
// IndexedDB getAll); we ALSO refresh on focus/online and on the flush-complete
// event, so this interval is just a backstop for backoff-timed retries.
const POLL_MS = 5000;

// Tone → chip classes, reusing the app's existing badge vocabulary
// (emerald/amber/red/muted, matching incident-status-pill + notification-row).
// Colour is ALWAYS paired with an icon + text below — never colour alone.
const toneChip: Record<QueueTone, string> = {
  good: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  warn: "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  bad: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  neutral: "bg-foreground/5 text-muted",
};

// Per-row state → dot classes for the panel list (icon/shape + text, not colour
// alone — the state word sits right beside it).
const stateDot: Record<OutboxItem["state"], string> = {
  pending: "bg-amber-500",
  syncing: "bg-amber-500 animate-pulse",
  synced: "bg-emerald-500",
  failed: "bg-red-500",
};

// A small icon for the connection half of the chip — a filled dot when online,
// a slashed dot when offline. Icon + the online/offline word; never colour alone.
function ConnGlyph({ online }: { online: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-3.5 w-3.5"
    >
      <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
      {online ? null : <path d="m4 4 16 16" />}
    </svg>
  );
}

// Live view of the outbox: counts + the item list, refreshed on a poll, on
// focus/online, and whenever a flush completes (onOutboxChange).
function useOutbox() {
  const [items, setItems] = useState<OutboxItem[] | null>(null);

  const refresh = useCallback(async () => {
    const store = getStore();
    if (!store) {
      setItems([]);
      return;
    }
    setItems(await list(store));
  }, []);

  useEffect(() => {
    // Subscribe the read to every "outbox may have changed" signal: the
    // flush-complete event, focus, regaining connectivity, and a backstop poll.
    // The setState always lands in one of these callbacks (or the async read's
    // own continuation) — never synchronously in the effect body.
    const onChange = () => void refresh();
    const unsub = onOutboxChange(onChange);
    const id = window.setInterval(onChange, POLL_MS);
    window.addEventListener("focus", onChange);
    window.addEventListener("online", onChange);
    // First read: deferred to a microtask so it's a callback, not a synchronous
    // effect-body setState (the read itself awaits IndexedDB anyway).
    queueMicrotask(onChange);
    return () => {
      unsub();
      window.clearInterval(id);
      window.removeEventListener("focus", onChange);
      window.removeEventListener("online", onChange);
    };
  }, [refresh]);

  return { items, refresh };
}

// Track navigator.onLine across `online`/`offline` events. Defaults to online
// (SSR / unknown), so we never falsely shout "offline" before hydration.
function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    // Sync the real value off the synchronous effect body (avoids a cascading
    // setState; the default `true` already covers the pre-event window).
    queueMicrotask(update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

// One outbox row in the expanded panel: kind + relative time + state, and for a
// failed item a Retry button that re-marks it due and triggers a flush.
function OutboxRow({
  item,
  now,
  onRetry,
}: {
  item: OutboxItem;
  now: Date;
  onRetry: (item: OutboxItem) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span
        aria-hidden
        className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${stateDot[item.state]}`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {t(kindLabelKey(item.kind))}
        </p>
        <p className="text-xs text-muted">
          {relativeTime(new Date(item.createdAt), now, locale)}
          {" · "}
          {t(stateLabelKey(item.state))}
        </p>
      </div>
      {isRetryable(item) ? (
        <button
          type="button"
          onClick={() => onRetry(item)}
          className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-medium text-foreground transition hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
        >
          {t("offline.retry")}
        </button>
      ) : null}
    </li>
  );
}

// Persistent connection + sync-state indicator, mounted in the app shell. It is
// the answer to "was my tap saved?": online/offline + the queue summary, with an
// aria-live region announcing changes. Tap to expand a per-item panel with Retry
// for failed items.
export function SyncIndicator() {
  const t = useTranslations();
  const online = useOnline();
  const { items, refresh } = useOutbox();
  const [open, setOpen] = useState(false);
  // A single render-time clock for all relative timestamps in the open panel.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, [open]);

  const counts = countStates(items ?? []);
  const summary = summariseQueue(counts);
  const queueLabel = t(summary.labelKey, { count: summary.count });
  const connLabel = online ? t("offline.online") : t("offline.offline");

  const onRetry = useCallback(
    async (item: OutboxItem) => {
      const store = getStore();
      if (!store) return;
      // Re-mark the failed item due (pending) so the next flush picks it up…
      await markPendingRetry(store, item.localId, PENDING_REASON_NETWORK);
      await refresh();
      // …then flush now. runFlush emits onOutboxChange, refreshing the panel.
      await runFlush();
    },
    [refresh],
  );

  // Until the store has been read once, render nothing (avoids a flash of
  // "all synced" before we know the real queue state).
  if (items === null) return null;

  return (
    <div className="px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left transition hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
      >
        {/* Connection chip — icon + word, never colour alone. */}
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            online ? toneChip.neutral : toneChip.bad
          }`}
        >
          <ConnGlyph online={online} />
          {connLabel}
        </span>
        {/* Queue summary chip — icon + word, never colour alone. */}
        <span
          className={`inline-flex flex-1 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${toneChip[summary.tone]}`}
        >
          <span
            aria-hidden
            className={`h-2 w-2 rounded-full ${stateDot[summary.tone === "good" ? "synced" : summary.tone === "bad" ? "failed" : "pending"]}`}
          />
          {queueLabel}
        </span>
        <ChevronIcon
          aria-hidden
          className={`h-4 w-4 shrink-0 text-muted transition ${open ? "rotate-90" : ""}`}
        />
      </button>

      {/* Polite live region: announces the connection + queue state without
          stealing focus. WCAG status announcement. */}
      <p aria-live="polite" className="sr-only">
        {t("offline.announce", { connection: connLabel, queue: queueLabel })}
      </p>

      {open ? (
        <div className="mt-2 overflow-hidden rounded-xl border border-border bg-surface">
          <p className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {t("offline.queueHeading")}
          </p>
          {hasQueueActivity(counts) ? (
            <ul className="divide-y divide-border">
              {(items ?? []).map((item) => (
                <OutboxRow
                  key={item.localId}
                  item={item}
                  now={now}
                  onRetry={onRetry}
                />
              ))}
            </ul>
          ) : (
            <div className="p-3">
              <EmptyState
                icon={<ConnGlyph online={online} />}
                title={t("offline.emptyTitle")}
                body={t("offline.emptyBody")}
              />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
