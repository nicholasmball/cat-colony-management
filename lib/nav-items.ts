// Pure, presentation-agnostic decision of WHICH nav items a given role sees.
// Kept free of React so it's trivially unit-testable; the component maps each
// item's href/label to an Icon locally (icons can't live in a pure lib cleanly).
//
// Feeders are redirected from /app to /app/today, so "Home" would duplicate
// "Today" for them — drop it. Caretakers and admins keep Home; admins also get
// the management items (Members, Organisation).

export type NavItem = { href: string; label: string; exact: boolean };

const homeItem: NavItem = { href: "/app", label: "Home", exact: true };
const coreItems: NavItem[] = [
  { href: "/app/today", label: "Today", exact: false },
  { href: "/app/colonies", label: "Colonies", exact: false },
];
const adminItems: NavItem[] = [
  { href: "/app/members", label: "Members", exact: false },
  { href: "/app/org", label: "Organisation", exact: false },
];

export function navItemsFor({ role }: { role?: string | null }): NavItem[] {
  const isManager = role === "admin" || role === "caretaker";
  const items: NavItem[] = isManager
    ? [homeItem, ...coreItems]
    : [...coreItems];
  if (role === "admin") items.push(...adminItems);
  return items;
}
