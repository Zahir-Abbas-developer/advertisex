import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma, transaction } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { avatarColorFor } from "@/lib/constants";
import { clientIp, consume } from "@/lib/rate-limit";
import { hashToken } from "@/modules/portal/server";

const schema = z
  .object({
    token: z.string().min(20).max(200),
    name: z.string().trim().min(2, "Your name, please").max(80),
    // The same rule as changing a password (app/api/me/password).
    password: z.string().min(10, "Use at least 10 characters").max(200, "That password is too long"),
  })
  .strict();

const GONE = "This invitation has expired or was already used. Ask your Advertise X contact for a new one.";

/**
 * Accepting a portal invitation (public — the token is the credential).
 * Creates the CLIENT login bound to exactly one ClientAccount, once: the
 * invitation is claimed atomically, so two simultaneous accepts can't both
 * create a login.
 */
export async function POST(request: Request) {
  // Public, so throttled: guessing tokens is 24 random bytes against 10 tries a minute.
  const limit = consume(`invite-accept:${clientIp(request.headers) ?? "unknown"}`, 10, 60_000);
  if (!limit.allowed) return apiError("Too many attempts — try again in a minute", 429);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));

  const invite = await prisma.clientInvite.findUnique({ where: { tokenHash: hashToken(parsed.data.token) } });
  if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt < new Date()) return apiError(GONE, 410);
  if (await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } })) {
    return apiError("An account with this email already exists — sign in instead.", 409);
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const created = await transaction(async (tx) => {
    const claimed = await tx.clientInvite.updateMany({
      where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) return false;
    await tx.user.create({
      data: {
        organizationId: invite.organizationId,
        clientAccountId: invite.clientAccountId,
        clientRole: invite.clientRole,
        name: parsed.data.name,
        email: invite.email,
        passwordHash,
        role: "CLIENT",
        jobTitle: invite.clientRole === "OWNER" ? "Owner" : "Team",
        mustChangePassword: false,
        avatarColor: avatarColorFor(parsed.data.name),
      },
    });
    return true;
  });
  if (!created) return apiError(GONE, 410);
  return NextResponse.json({ ok: true, email: invite.email }, { status: 201 });
}
