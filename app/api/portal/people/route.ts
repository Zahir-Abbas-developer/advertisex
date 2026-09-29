import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { accountOf, accountPeople, createInvite, isOwner, PortalError } from "@/modules/portal/server";
import { sendInviteEmail } from "@/modules/portal/invite-email";
import { limited } from "@/lib/rate-limit";

/** Who can sign in to this account, and pending invitations. */
export async function GET() {
  const gate = await requireApi("read", "portalUser");
  if (gate.response) return gate.response;
  if (gate.principal.role !== "CLIENT") return apiError("Not found", 404);
  return NextResponse.json({ ...(await accountPeople(accountOf(gate.principal))), viewer: { id: gate.principal.id, isOwner: await isOwner(gate.principal) } });
}

const schema = z.object({ name: z.string().trim().min(2, "Their name, please").max(80), email: z.string().trim().email("A valid email, please").max(160) }).strict();

/**
 * An account owner invites a colleague. Role-limited: an owner can only add
 * MEMBERs (who see projects, reports and messages, not billing, and can't
 * invite). New owners are the founder's to add.
 */
export async function POST(request: Request) {
  const gate = await requireApi("create", "portalUser");
  if (gate.response) return gate.response;
  const throttled = limited("invites", gate.principal.id);
  if (throttled) return throttled;
  if (gate.principal.role !== "CLIENT") return apiError("Not found", 404);
  if (!(await isOwner(gate.principal))) return apiError("Only your account's owner can invite people", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  const account = await prisma.clientAccount.findUniqueOrThrow({ where: { id: accountOf(gate.principal) }, select: { id: true, name: true, organizationId: true } });
  try {
    const { invite, path } = await createInvite({ organizationId: account.organizationId, clientAccountId: account.id, email: parsed.data.email, name: parsed.data.name, clientRole: "MEMBER", invitedById: gate.principal.id });
    const emailed = await sendInviteEmail({ to: invite.email, name: parsed.data.name, accountName: account.name, path });
    return NextResponse.json({ invite, link: path, emailed }, { status: 201 });
  } catch (error) {
    if (error instanceof PortalError) return apiError(error.message, error.status, { email: error.message });
    throw error;
  }
}
