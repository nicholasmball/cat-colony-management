// Pure password-pair validation, shared by the accept flow and the password
// reset flow. Returns the ERROR-CATALOGUE KEY (under the `errors` namespace) for
// the first failing rule, or null when the pair is acceptable — kept pure so the
// rules are node:test-able and identical wherever a user sets a password.
//
// Rules (mirror app/accept/actions.ts): at least 8 chars, and the confirmation
// must match. The minimum is also enforced by the form's minLength, but never
// trust the client.
export const MIN_PASSWORD_LENGTH = 8;

export type PasswordErrorKey = "passwordTooShort" | "passwordsDontMatch";

export function passwordError(
  password: string,
  confirm: string,
): PasswordErrorKey | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "passwordTooShort";
  if (password !== confirm) return "passwordsDontMatch";
  return null;
}
