// First-run onboarding logic — pure so it's unit-testable and the home page
// stays declarative. Given an org's colony/cat counts, decide which setup step
// to nudge next. "schedule" is intentionally NOT a step here: that screen
// doesn't exist yet, so the welcome shows it as "coming soon" without a link.

export type FirstRunStep = "colony" | "cat" | "done";

export function firstRunStep({
  colonies,
  cats,
}: {
  colonies: number;
  cats: number;
}): FirstRunStep {
  if (colonies <= 0) return "colony";
  if (cats <= 0) return "cat";
  return "done";
}
