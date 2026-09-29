import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { accountOf, isOwner } from "@/modules/portal/server";

/**
 * An owner removes a colleague (their login is switched off) or withdraws an
 * invitation. Never themselves, never another owner, never outside the account.
 */
export async function DELETE(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("delete", "portalUser");
  if (gate.response) return gate.response;
  if (gate.principal.role !== "CLIENT") return apiError("Not found", 404);
  if (!(await isOwner(gate.principal))) return apiError("Only your account's owner can remove people", 403);
  const account = accountOf(gate.principal);

  const invite = await prisma.clientInvite.findFirst({ where: { id: params.id, clientAccountId: account, acceptedAt: null, revokedAt: null } });
  if (invite) {
    await prisma.clientInvite.update({ where: { id: invite.id }, data: { revokedAt: new Date() } });
    return NextResponse.json({ ok: true });
  }
  const user = await prisma.user.findFirst({ where: { id: params.id, clientAccountId: account, role: "CLIENT" }, select: { id: true, clientRole: true } });
  if (!user) return apiError("Not found", 404);
  if (user.id === gate.principal.id) return apiError("You can't remove yourself", 422);
  if (user.clientRole === "OWNER") return apiError("Owners are managed by Advertise X", 403);
  await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
