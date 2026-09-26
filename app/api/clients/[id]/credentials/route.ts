import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { canOnCredentials, clientRef, createCredential, CREDENTIAL_KINDS, listCredentials } from "@/modules/vault/credentials";

/**
 * A client's credentials vault. The list is always masked — the secret
 * leaves the server only through /api/credentials/[id]/reveal.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("read", "credential");
  if (gate.response) return gate.response;
  const client = await clientRef(params.id);
  if (!client || !canOnCredentials(gate.principal, "read", client)) return apiError("Not found", 404);

  return NextResponse.json(
    {
      credentials: await listCredentials(client.id),
      canReveal: canOnCredentials(gate.principal, "reveal", client),
      canManage: canOnCredentials(gate.principal, "create", client),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const credentialSchema = z
  .object({
    label: z.string().trim().min(1, "Name the login").max(80),
    kind: z.enum(CREDENTIAL_KINDS).default("OTHER"),
    url: z.string().trim().max(300).nullish(),
    username: z.string().trim().max(200).nullish(),
    notes: z.string().trim().max(1000).nullish(),
    secret: z.string().min(1, "Enter the password or key").max(4000),
  })
  .strict();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("create", "credential");
  if (gate.response) return gate.response;
  const client = await clientRef(params.id);
  if (!client || !canOnCredentials(gate.principal, "read", client)) return apiError("Not found", 404);
  if (!canOnCredentials(gate.principal, "create", client)) return apiError("You can't add logins for this client", 403);

  const parsed = credentialSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  }
  const credential = await createCredential(gate.principal, client, parsed.data);
  return NextResponse.json({ credential }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
