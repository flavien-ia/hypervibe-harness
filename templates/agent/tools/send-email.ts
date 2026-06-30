// agent/tools/send-email.ts - Send a transactional email from the agent.
//
// Wraps the existing project mail layer (~/server/mail) so the agent uses
// whatever email provider is configured (Brevo or Resend). The agent can
// send to any recipient, but the FROM address is fixed to the project's
// configured sender - agents can't impersonate.
//
// Safety:
//   - Subject capped at 200 chars
//   - Body capped at 100 KB (truncated with notice)
//   - HTML escaping handled by the project's existing mail wrapper
//
// To wire up: replace the import below with your project's mail entry point.

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { sendMail } from "../mail.js";

const definition: Tool = {
  name: "send_email",
  description:
    "Send an email to one or more recipients. Use this when the agent's job involves notifying someone - sending a daily digest, replying to an inquiry, alerting an admin. The FROM address is fixed to the project's configured sender (you can't impersonate). Plain-text body is wrapped in a minimal HTML template.",
  input_schema: {
    type: "object",
    properties: {
      to: {
        type: "array",
        items: { type: "string", description: "Recipient email address" },
        description: "List of recipient email addresses (1 to 50).",
      },
      subject: {
        type: "string",
        description: "Email subject line (max 200 chars).",
      },
      body: {
        type: "string",
        description: "Email body in plain text. Newlines are preserved as <br>. (Max 100 KB.)",
      },
      replyTo: {
        type: "string",
        description: "Optional Reply-To address (e.g. so the recipient can reply directly to a user).",
      },
    },
    required: ["to", "subject", "body"],
  },
};

async function handler(input: Record<string, unknown>): Promise<string> {
  const to = Array.isArray(input.to) ? (input.to as string[]) : [];
  const subject = String(input.subject ?? "").slice(0, 200);
  let body = String(input.body ?? "");
  const replyTo = input.replyTo ? String(input.replyTo) : undefined;

  if (to.length === 0) return `Error: 'to' must contain at least one email address`;
  if (to.length > 50) return `Error: 'to' must contain at most 50 addresses (got ${to.length})`;
  if (!subject) return `Error: 'subject' is required`;
  if (!body) return `Error: 'body' is required`;

  if (body.length > 100_000) {
    body = body.slice(0, 100_000) + "\n\n[truncated by agent send-email tool: body exceeded 100 KB]";
  }

  const htmlContent = `<div style="font-family: -apple-system, sans-serif; font-size: 15px; line-height: 1.6; color: #1A1410;">${
    body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br />")
  }</div>`;

  try {
    await sendMail({
      to: to.map((email) => ({ email })),
      subject,
      htmlContent,
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
    });
    return `OK: email sent to ${to.length} recipient(s)`;
  } catch (e) {
    return `Error sending email: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export const tool = { definition, handler };
