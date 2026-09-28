import "server-only";

import { isEmailConfigured, sendEmail } from "@/lib/email/send";

/**
 * Emails a portal invitation when email is set up (SMTP_* and EMAIL_FROM).
 * Without it the inviter is shown the link to pass on — never a dead end.
 */
export async function sendInviteEmail(input: { to: string; name: string; accountName: string; path: string }): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  const base = process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const url = `${base.replace(/\/$/, "")}${input.path}`;
  const text = `Hi ${input.name},\n\nYou've been invited to see ${input.accountName}'s projects, reports and messages with Advertise X.\n\nSet your password here (the link works for 7 days):\n${url}\n\n— Advertise X`;
  const escape = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const result = await sendEmail(input.to, {
    subject: `You're invited to ${input.accountName} on Advertise X`,
    text,
    html: `<p>Hi ${escape(input.name)},</p><p>You've been invited to see ${escape(input.accountName)}'s projects, reports and messages with Advertise X.</p><p><a href="${escape(url)}">Set your password</a> (the link works for 7 days).</p><p>— Advertise X</p>`,
  });
  return result.status === "sent";
}
