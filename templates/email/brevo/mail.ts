import { BrevoClient } from "@getbrevo/brevo";

const client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY! });

/**
 * Escape user-provided data before inserting it into an email body.
 *
 * Handles two concerns at once:
 *   1. Standard HTML injection (`<`, `>`, `&`, `"`, `'`)
 *   2. Brevo implicit templating: Brevo runs a Mustache-style templating pass
 *      on htmlContent AND textContent at send time. Any `{{` in the body
 *      (e.g. a stack trace, malformed-JSON error, or user-supplied text)
 *      raises an async parse failure - the SDK call has already returned 201
 *      by then, so the try/catch sees nothing and the email is silently dropped.
 *      Escape `{` and `}` to defuse this.
 *
 * MUST be applied to every user-provided or error-derived field inserted into
 * `htmlContent`. For `textContent`, at minimum split `{{` (e.g. `.replace(/\{\{/g, "{ {")`).
 */
export function escapeForBrevo(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}

interface SendMailOptions {
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
  textContent?: string;
  sender?: { email: string; name: string };
}

export async function sendMail(options: SendMailOptions) {
  return client.transactionalEmails.sendTransacEmail({
    to: options.to,
    subject: options.subject,
    htmlContent: options.htmlContent,
    textContent: options.textContent,
    sender: options.sender ?? {
      email: process.env.BREVO_SENDER_EMAIL!,
      name: process.env.BREVO_SENDER_NAME ?? "App",
    },
  });
}
