import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { clientFor } from "@/modules/clients/server";

/** Notes about a client; pinned ones are its "important notes". */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "client");
  if (gate.response) return gate.response;
  const found = await clientFor(gate.principal, params.id, "read");
  if (!found.client) return apiError("Not found", found.status);
  const notes = await prisma.clientNote.findMany({
    where: { clientId: params.id },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: { id: true, body: true, pinned: true, createdAt: true, updatedAt: true, author: { select: { id: true, name: true, avatarColor: true } } },
  });
  return NextResponse.json({ notes });
}

const schema = z.object({ body: z.string().trim().min(1, "Write the note").max(4000), pinned: z.boolean().default(false) }).strict();

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("update", "client");
  if (gate.response) return gate.response;
  const found = await clientFor(gate.principal, params.id, "update");
  if (!found.client) return apiError("Not found", found.status);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, { body: "Write the note" });
  const note = await prisma.clientNote.create({
    data: {
      organizationId: found.client.organizationId ?? gate.principal.organizationId ?? "",
      clientId: found.client.id,
      authorId: gate.principal.id,
      body: parsed.data.body,
      pinned: parsed.data.pinned,
    },
    select: { id: true },
  });
  return NextResponse.json({ note }, { status: 201 });
}
