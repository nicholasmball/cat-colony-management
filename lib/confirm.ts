// Decide whether a confirm() result should block a destructive form submit.
// Only an explicit "Cancel" (false) blocks. A suppressed/unavailable dialog
// returns undefined (realistic in an installed display:standalone PWA) — in
// that case the user already deliberately clicked the destructive button, so
// the submit must proceed rather than be silently swallowed.
export function shouldBlockSubmit(confirmResult: boolean | undefined): boolean {
  return confirmResult === false;
}
