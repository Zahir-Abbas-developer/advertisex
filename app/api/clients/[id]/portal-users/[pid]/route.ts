import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { clientFor } from "@/modules/clients/server";

/** Withdraws an invitation or switches off a portal login for this client. */
export async function DELETE(_request: Request, { params }: { params: { id: string; pid: string } }) {
  const gate = await requireApi("delete", "portalUser");
  if (gate.response) return gate.response;
  if (gate.principal.role === "CLIENT") return apiError("Not found", 404);
  const found = await clientFor(gate.principal, params.id, "read");
  if (!found.client?.clientAccountId) return apiError("Not found", 404);
  const accountId = found.client.clientAccountId;

  const invite = await prisma.clientInvite.findFirst({ where: { id: params.pid, clientAccountId: accountId, acceptedAt: null, revokedAt: null } });
  if (invite) {
    await prisma.clientInvite.update({ where: { id: invite.id }, data: { revokedAt: new Date() } });
    return NextResponse.json({ ok: true });
  }
  const { count } = await prisma.user.updateMany({ where: { id: params.pid, clientAccountId: accountId, role: "CLIENT" }, data: { isActive: false } });
  if (!count) return apiError("Not found", 404);
  return NextResponse.json({ ok: true });
}
