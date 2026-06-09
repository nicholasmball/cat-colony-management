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
// Manager (admin + caretaker) items — they triage incidents.
const managerItems: NavItem[] = [
  { href: "/app/incidents", labelKey: "nav.incidents", exact: false },
];
const adminItems: NavItem[] = [
  { href: "/app/members", labelKey: "nav.members", exact: false },
  { href: "/app/org", labelKey: "nav.org", exact: false },
];

export function navItemsFor({ role }: { role?: string | null }): NavItem[] {
  const isManager = role === "admin" || role === "caretaker";
  const items: NavItem[] = isManager
    ? [dashboardItem, ...coreItems, ...managerItems]
    : [...coreItems];
  if (role === "admin") items.push(...adminItems);
  return items;
}
