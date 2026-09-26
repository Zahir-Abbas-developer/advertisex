import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { clientFor } from "@/modules/clients/server";

const schema = z.object({ body: z.string().trim().min(1).max(4000).optional(), pinned: z.boolean().optional() }).strict();

/** Anyone who may edit the client pins or edits notes; authors and managers remove them. */
export async function PATCH(request: Request, { params }: { params: { id: string; noteId: string } }) {
  const gate = await requireApi("update", "client");
  if (gate.response) return gate.response;
  const found = await clientFor(gate.principal, params.id, "update");
  if (!found.client) return apiError("Not found", found.status);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422);
  const { count } = await prisma.clientNote.updateMany({ where: { id: params.noteId, clientId: params.id }, data: parsed.data });
  if (!count) return apiError("Not found", 404);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: { id: string; noteId: string } }) {
  const gate = await requireApi("update", "client");
  if (gate.response) return gate.response;
  const found = await clientFor(gate.principal, params.id, "update");
  if (!found.client) return apiError("Not found", found.status);
  const note = await prisma.clientNote.findFirst({ where: { id: params.noteId, clientId: params.id }, select: { id: true, authorId: true } });
  if (!note) return apiError("Not found", 404);
  if (gate.principal.role === "EMPLOYEE" && note.authorId !== gate.principal.id) return apiError("Only its author or a manager can remove a note", 403);
  await prisma.clientNote.delete({ where: { id: note.id } });
  return NextResponse.json({ ok: true });
}
