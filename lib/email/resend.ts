import type { Email } from "@/lib/email/templates";

/** An email attachment (PDFs today). */
export type Attachment = { filename: string; content: Buffer | Uint8Array; contentType?: string };

/** Resend's request body for one message (pure — unit-tested). */
export function resendPayload(from: string, to: string, email: Email, attachments: Attachment[] = []) {
  return {
    from,
    to: [to],
    subject: email.subject,
    html: email.html,
    text: email.text,
    ...(attachments.length
      ? { attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64") })) }
      : {}),
  };
}
