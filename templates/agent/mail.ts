// agent/mail.ts - Minimal email helper for the agent worker.
//
// The agent runs in a separate Render Background Worker process (apps/agent/),
// SO it can't directly import the main app's mail wrapper. We re-implement a
// thin wrapper here using the same provider configured in the main app
// (Brevo or Resend). Env vars are passed at deploy time.
//
// Auto-detects which provider based on which env vars are present:
//   - If BREVO_API_KEY is set     → uses Brevo
//   - Else if RESEND_API_KEY      → uses Resend
//   - Else                         → throws (no email provider configured)

import type { ToolName } from "./tools/index.js";

// ─── Types ────────────────────────────────────────────────────────────
export interface SendMailOptions {
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
  textContent?: string;
  replyTo?: { email: string; name?: string };
}

// ─── Provider detection + send ────────────────────────────────────────
export async function sendMail(opts: SendMailOptions): Promise<void> {
  // Strip empty names (Brevo rejects name: "" with HTTP 400 - known footgun).
  const cleanTo = opts.to.map((r) => (r.name?.trim() ? r : { email: r.email }));
  const cleanReplyTo = opts.replyTo?.name?.trim() ? opts.replyTo : opts.replyTo ? { email: opts.replyTo.email } : undefined;

  if (process.env.BREVO_API_KEY) {
    return sendViaBrevo({ ...opts, to: cleanTo, replyTo: cleanReplyTo });
  }
  if (process.env.RESEND_API_KEY) {
    return sendViaResend({ ...opts, to: cleanTo, replyTo: cleanReplyTo });
  }
  throw new Error("No email provider configured (BREVO_API_KEY or RESEND_API_KEY missing)");
}

async function sendViaBrevo(opts: SendMailOptions): Promise<void> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY!,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: process.env.BREVO_SENDER_EMAIL!,
        ...(process.env.BREVO_SENDER_NAME ? { name: process.env.BREVO_SENDER_NAME } : {}),
      },
      to: opts.to,
      subject: opts.subject,
      htmlContent: opts.htmlContent,
      ...(opts.textContent ? { textContent: opts.textContent } : {}),
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Brevo API error (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

async function sendViaResend(opts: SendMailOptions): Promise<void> {
  const from = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: opts.to.map((r) => r.email),
      subject: opts.subject,
      html: opts.htmlContent,
      ...(opts.textContent ? { text: opts.textContent } : {}),
      ...(opts.replyTo ? { reply_to: opts.replyTo.email } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend API error (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

// ─── Failure notification ─────────────────────────────────────────────
export async function sendAgentFailureEmail(opts: {
  agentName: string;
  invocationId: string;
  reason: string;
}): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.warn("[agent] sendAgentFailureEmail: ADMIN_EMAIL not set, skipping notification");
    return;
  }
  const dashboardUrl = process.env.NEXT_PUBLIC_SITE_URL
    ? `${process.env.NEXT_PUBLIC_SITE_URL}/agents/${opts.agentName}/invocations/${opts.invocationId}`
    : null;
  const html = `
    <div style="font-family:-apple-system,sans-serif;font-size:15px;line-height:1.6;max-width:600px;">
      <h2 style="color:#1A1410;">⚠️ Ton agent <code>${escape(opts.agentName)}</code> a un problème</h2>
      <p><strong>Raison :</strong> ${escape(opts.reason)}</p>
      <p><strong>Invocation :</strong> <code>${escape(opts.invocationId)}</code></p>
      ${dashboardUrl ? `<p><a href="${escape(dashboardUrl)}" style="color:#8B5CF6;">Voir le détail dans le dashboard →</a></p>` : ""}
      <p style="color:#7A7168;font-size:13px;margin-top:24px;">Cet email vient de ton agent Hypervibe. Si l'erreur est due au plafond budgétaire, l'agent reste en pause jusqu'au prochain cycle (jour ou mois selon le plafond touché).</p>
    </div>
  `;
  try {
    await sendMail({
      to: [{ email: adminEmail }],
      subject: `[Agent ${opts.agentName}] Erreur ou plafond atteint`,
      htmlContent: html,
    });
  } catch (e) {
    console.error("[agent] Failed to send failure email:", e);
  }
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Re-export ToolName so loop.ts can access it via this module too.
export type { ToolName };
