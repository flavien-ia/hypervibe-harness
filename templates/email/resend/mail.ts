import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Escape HTML special characters to prevent injection in email templates.
 * MUST be applied to all user-provided data before inserting into HTML emails.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface SendMailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

/**
 * A link to the development machine has no place in an email: nobody can open
 * it. It happens when a script that sends mail runs on a workstation with a
 * `.env` whose public URL is `http://localhost:3000`, and it reached real
 * recipients once (Hypervibe 3.1.5 announcement, 2026-09-13). The send is
 * refused with an error that names the cause. `MAIL_ALLOW_LOCAL_LINKS=1`, set
 * by a person in the environment, lifts the refusal for a test bench.
 */
const LOCAL_LINK = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i;

function refuseLocalLinks(subject: string, ...bodies: (string | undefined)[]): void {
  if (process.env.MAIL_ALLOW_LOCAL_LINKS === "1") return;
  if (bodies.some((body) => body !== undefined && LOCAL_LINK.test(body))) {
    throw new Error(
      `sendMail refused: "${subject}" contains a link to localhost. Send from production, or set MAIL_ALLOW_LOCAL_LINKS=1 for a test bench.`,
    );
  }
}

export async function sendMail(options: SendMailOptions) {
  refuseLocalLinks(options.subject, options.html, options.text);
  const { data, error } = await resend.emails.send({
    from: options.from ?? process.env.RESEND_FROM_EMAIL!,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }

  return data;
}
