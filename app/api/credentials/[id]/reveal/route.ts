import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { logger, errorFields } from "@/lib/logger";
import { requireApi } from "@/modules/rbac/server";
import { canOnCredentials, clientRef, reveal } from "@/modules/vault/credentials";

/**
 * Opens one sealed secret. POST, not GET: a reveal is an action with a
 * consequence (an audit entry), and must never be prefetched or cached.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("reveal", "credential");
  if (gate.response) return gate.response;
  const row = await prisma.clientCredential.findUnique({ where: { id: params.id }, select: { id: true, clientId: true, label: true } });
  const client = row ? await clientRef(row.clientId) : null;
  if (!row || !client || !canOnCredentials(gate.principal, "read", client)) return apiError("Not found", 404);
  if (!canOnCredentials(gate.principal, "reveal", client)) return apiError("You can't open this login", 403);

  try {
    const secret = await reveal(gate.principal, row.id, client, row.label);
    return NextResponse.json({ secret }, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  } catch (error) {
    // Never the secret, never the key — only that it failed.
    logger.error("vault.reveal_failed", { credentialId: row.id, ...errorFields(error) });
    return apiError("This login couldn't be opened. Nothing was revealed.", 500);
  }
}
