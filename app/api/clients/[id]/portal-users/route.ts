import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { clientFor } from "@/modules/clients/server";
import { accountPeople, createInvite, PortalError } from "@/modules/portal/server";
import { sendInviteEmail } from "@/modules/portal/invite-email";
import { limited } from "@/lib/rate-limit";

async function load(principalId: Parameters<typeof clientFor>[0], id: string) {
  const found = await clientFor(principalId, id, "read");
  if (!found.client) return null;
  return found.client;
}

/** A client's portal logins and pending invitations. */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "portalUser");
  if (gate.response) return gate.response;
  if (gate.principal.role === "CLIENT") return apiError("Not found", 404);
  const client = await load(gate.principal, params.id);
  if (!client) return apiError("Not found", 404);
  if (!client.clientAccountId) return NextResponse.json({ users: [], invites: [], hasPortal: false });
  return NextResponse.json({ ...(await accountPeople(client.clientAccountId)), hasPortal: true });
}

const schema = z
  .object({
    name: z.string().trim().min(2, "Their name, please").max(80),
    email: z.string().trim().email("A valid email, please").max(160),
    clientRole: z.enum(["OWNER", "MEMBER"]).default("OWNER"),
  })
  .strict();

/**
 * Invites someone to this client's portal. Invite-only: no one signs up. A
 * client without a portal account gets one on its first invitation.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("create", "portalUser");
  if (gate.response) return gate.response;
  const throttled = limited("invites", gate.principal.id);
  if (throttled) return throttled;
  if (gate.principal.role === "CLIENT") return apiError("Not found", 404);
  const client = await load(gate.principal, params.id);
  if (!client) return apiError("Not found", 404);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  if (!client.organizationId) return apiError("This client has no organization", 422);

  let accountId = client.clientAccountId;
  if (!accountId) {
    const account = await prisma.clientAccount.create({ data: { organizationId: client.organizationId, name: client.businessName } });
    await prisma.client.update({ where: { id: client.id }, data: { clientAccountId: account.id } });
    accountId = account.id;
  }
  try {
    const { invite, path } = await createInvite({ organizationId: client.organizationId, clientAccountId: accountId, email: parsed.data.email, name: parsed.data.name, clientRole: parsed.data.clientRole, invitedById: gate.principal.id });
    const emailed = await sendInviteEmail({ to: invite.email, name: parsed.data.name, accountName: client.businessName, path });
    return NextResponse.json({ invite, link: path, emailed }, { status: 201 });
  } catch (error) {
    if (error instanceof PortalError) return apiError(error.message, error.status, { email: error.message });
    throw error;
  }
}
