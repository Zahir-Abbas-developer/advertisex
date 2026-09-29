import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import type { Email } from "@/lib/email/templates";
import { resendPayload, type Attachment } from "@/lib/email/resend";

export type { Attachment } from "@/lib/email/resend";

/**
 * Email delivery: Resend's HTTP API when RESEND_API_KEY is set (Phase 8), else
 * SMTP (any provider), else nothing.
 *
 * Configured entirely by environment, and deliberately inert when it isn't:
 * with neither set, messages are logged and reported as "skipped" rather than
 * thrown. Adding a member must not fail because the mail server is down, and
 * local development must not need one at all.
 */

export type SendResult =
  | { status: "sent"; messageId: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

let cached: Transporter | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.EMAIL_FROM && (process.env.RESEND_API_KEY || process.env.SMTP_HOST));
}

async function sendViaResend(to: string, email: Email, attachments: Attachment[]): Promise<SendResult> {
  try {
    // RESEND_BASE_URL exists for tests (a local stand-in); production uses Resend's API.
    const res = await fetch(`${(process.env.RESEND_BASE_URL ?? "https://api.resend.com").replace(/\/$/, "")}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(resendPayload(process.env.EMAIL_FROM!, to, email, attachments)),
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !body.id) return { status: "failed", reason: `Resend ${res.status}: ${body.message ?? "no id"}` };
    return { status: "sent", messageId: body.id };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "unknown" };
  }
}

function transporter(): Transporter | null {
  if (!process.env.SMTP_HOST || !process.env.EMAIL_FROM) return null;
  if (cached) return cached;

  const port = Number(process.env.SMTP_PORT ?? 587);

  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });

  return cached;
}

export async function sendEmail(to: string, email: Email, opts: { attachments?: Attachment[] } = {}): Promise<SendResult> {
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) return sendViaResend(to, email, opts.attachments ?? []);
  const mailer = transporter();

  if (!mailer) {
    // Loud enough to find in a log, quiet enough not to break the request.
    console.info(
      `[email] skipped (email not configured) → ${to}: ${email.subject}`,
    );
    return { status: "skipped", reason: "email not configured" };
  }

  try {
    const info = await mailer.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      attachments: opts.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })),
    });
    return { status: "sent", messageId: info.messageId };
  } catch (error) {
    // Never rethrow: the work that triggered this already succeeded.
    console.error(`[email] failed → ${to}: ${email.subject}`, error);
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "unknown",
    };
  }
}

/** Absolute base URL for links inside emails. */
export function appUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}
