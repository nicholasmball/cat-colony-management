// Provider-agnostic transactional-email entry point. Callers (the invite action,
// the digest cron, future senders) depend ONLY on send() — never on Resend.
//
// Flag-gated + armed-ready (see flags.ts): when the mode is "off" (the default
// build, until Nick wires EMAIL_ENABLED + RESEND_API_KEY) send() is a typed
// NO-OP — it returns {skipped:true} and emits a structured log, and NEVER
// throws. When "send", it renders the template and calls the adapter; any
// adapter error is caught, logged as email.error, and returned as a non-throwing
// failure — a broken email provider can never break an invite or a cron run.
//
// Env is read at CALL time (not module load) so the same artifact arms by env
// var alone. The adapter is injectable for tests (mock the provider, assert the
// off-path never calls it) — production uses the default Resend adapter.

import { type Locale } from "../../i18n/locale.ts";
import { emailModeFromEnv } from "./flags.ts";
import {
  sendViaResend,
  type AdapterMessage,
  type AdapterResult,
} from "./adapter-resend.ts";
import { renderInvite, type InviteParams } from "./templates/invite.ts";
import {
  renderDailyDigest,
  type DigestParams,
} from "./templates/daily-digest.ts";
import { type EmailContent } from "./templates/layout.ts";

// Discriminated union of every template + its params, so a caller can't pass
// digest params to the invite template (no `any`, fully type-checked).
export type EmailMessage =
  | { template: "invite"; params: InviteParams }
  | { template: "daily-digest"; params: DigestParams };

export type SendArgs = {
  to: string;
  locale: Locale;
} & EmailMessage;

export type SendResult =
  | { skipped: true }
  | { skipped: false; ok: true; id?: string }
  | { skipped: false; ok: false; error: string };

// Adapter seam — the provider call. Defaults to Resend; tests inject a mock.
export type EmailAdapter = (message: AdapterMessage) => Promise<AdapterResult>;

function render(args: SendArgs): EmailContent {
  switch (args.template) {
    case "invite":
      return renderInvite(args.locale, args.params);
    case "daily-digest":
      return renderDailyDigest(args.locale, args.params);
  }
}

export async function send(
  args: SendArgs,
  adapter: EmailAdapter = sendViaResend,
): Promise<SendResult> {
  const mode = emailModeFromEnv();

  if (mode === "off") {
    // Structured no-op log — proves the path ran without sending. No PII beyond
    // the recipient is logged; the template name aids debugging once armed.
    console.info(
      JSON.stringify({
        event: "email.skipped",
        template: args.template,
        to: args.to,
        reason: "EMAIL_ENABLED/RESEND_API_KEY not set",
      }),
    );
    return { skipped: true };
  }

  const from = process.env.EMAIL_FROM ?? "";
  const content = render(args);

  try {
    const result = await adapter({
      from,
      to: args.to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
    if (!result.ok) {
      console.error(
        JSON.stringify({
          event: "email.error",
          template: args.template,
          to: args.to,
          error: result.error,
        }),
      );
      return { skipped: false, ok: false, error: result.error };
    }
    return { skipped: false, ok: true, id: result.id };
  } catch (e) {
    // The adapter (or its lazy SDK import) threw — swallow so callers never
    // break, log for diagnosis, return a typed failure.
    const error = e instanceof Error ? e.message : String(e);
    console.error(
      JSON.stringify({
        event: "email.error",
        template: args.template,
        to: args.to,
        error,
      }),
    );
    return { skipped: false, ok: false, error };
  }
}
