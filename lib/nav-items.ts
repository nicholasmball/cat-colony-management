// Pure, presentation-agnostic decision of WHICH nav items a given role sees.
// Kept free of React so it's trivially unit-testable; the component maps each
// item's href/label to an Icon locally (icons can't live in a pure lib cleanly).
//
// Feeders are redirected from /app to /app/today, so a "Home" item would
// duplicate "Today" for them — they get only the core items. Caretakers and
// admins lead with the Dashboard (their oversight roll-up + post-login landing)
// and get the manager items (Incidents — they triage/resolve); admins
// additionally get the admin-only items (Members, Organisation). Feeders have
// no triage list — they reach an incident only via a link — so Incidents and
// the Dashboard are gated to managers. /app stays reachable as the landing
// router but no longer has its own nav entry (Dashboard replaces "Home").

// labelKey is an i18n message key (namespace `nav`), NOT a display string — the
// label is translated in components/app-nav.tsx. This keeps the lib pure and
// React/next-intl-free so it stays trivially unit-testable.
export type NavItem = { href: string; labelKey: string; exact: boolean };

const dashboardItem: NavItem = {
  href: "/app/dashboard",
  labelKey: "nav.dashboard",
  exact: true,
};
const coreItems: NavItem[] = [
  { href: "/app/today", labelKey: "nav.today", exact: false },
  { href: "/app/colonies", labelKey: "nav.colonies", exact: false },
];
// Manager (admin + caretaker) items — they triage incidents and are the only
// alert recipients, so the Notifications centre is gated to them too.
const managerItems: NavItem[] = [
  { href: "/app/incidents", labelKey: "nav.incidents", exact: false },
  { href: "/app/notifications", labelKey: "nav.notifications", exact: false },
  // Alert thresholds live in managerItems (admin + caretaker), NOT adminItems:
  // both manager roles tune the org's not-seen / missed-feed thresholds.
  { href: "/app/alerts", labelKey: "nav.alerts", exact: false },
];
const adminItems: NavItem[] = [
  { href: "/app/members", labelKey: "nav.members", exact: false },
  { href: "/app/org", labelKey: "nav.org", exact: false },
];
// Help / quick-start is for EVERY role (feeders most of all — they get no
// training). It trails every role's list so it never bumps a working item out
// of the mobile tab bar's primary cells: feeders (few items) see it inline,
// managers find it under "More".
const helpItem: NavItem = {
  href: "/app/help",
  labelKey: "nav.help",
  exact: false,
};

export function navItemsFor({ role }: { role?: string | null }): NavItem[] {
  const isManager = role === "admin" || role === "caretaker";
  const items: NavItem[] = isManager
    ? [dashboardItem, ...coreItems, ...managerItems]
    : [...coreItems];
  if (role === "admin") items.push(...adminItems);
  items.push(helpItem);
  return items;
}

// The mobile bottom tab bar only fits ~5 cells before labels collide (admins
// have 8 items: "Notifications"/"Alert thresholds"/"Organisation" overflowed).
// With more than `maxCells`, show the first `maxCells - 1` inline and collapse
// the rest under a "More" sheet. Pure + React-free so it stays unit-testable.
export function splitNavForTabbar<T extends NavItem>(
  items: T[],
  maxCells = 5,
): { visible: T[]; overflow: T[] } {
  if (items.length <= maxCells) return { visible: items, overflow: [] };
  return {
    visible: items.slice(0, maxCells - 1),
    overflow: items.slice(maxCells - 1),
  };
}
