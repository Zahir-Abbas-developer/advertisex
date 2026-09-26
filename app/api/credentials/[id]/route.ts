import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { canOnCredentials, clientRef, CREDENTIAL_KINDS, updateCredential } from "@/modules/vault/credentials";

async function load(id: string) {
  const row = await prisma.clientCredential.findUnique({ where: { id }, select: { id: true, clientId: true, label: true } });
  if (!row) return null;
  const client = await clientRef(row.clientId);
  return client ? { row, client } : null;
}

const patchSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    kind: z.enum(CREDENTIAL_KINDS).optional(),
    url: z.string().trim().max(300).nullable().optional(),
    username: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    /** Only when replacing it — omitted means unchanged. */
    secret: z.string().min(1).max(4000).optional(),
  })
  .strict();

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("update", "credential");
  if (gate.response) return gate.response;
  const found = await load(params.id);
  if (!found || !canOnCredentials(gate.principal, "read", found.client)) return apiError("Not found", 404);
  if (!canOnCredentials(gate.principal, "update", found.client)) return apiError("You can't change this login", 403);

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422);
  const credential = await updateCredential(found.row.id, parsed.data);
  return NextResponse.json({ credential }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("delete", "credential");
  if (gate.response) return gate.response;
  const found = await load(params.id);
  if (!found || !canOnCredentials(gate.principal, "read", found.client)) return apiError("Not found", 404);
  if (!canOnCredentials(gate.principal, "delete", found.client)) return apiError("You can't remove this login", 403);

  await prisma.clientCredential.delete({ where: { id: found.row.id } });
  return NextResponse.json({ ok: true });
}
