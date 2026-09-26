import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { read } from "@/lib/uploads";
import { requireApi } from "@/modules/rbac/server";
import { taskAccess } from "@/modules/tasks/server";

/**
 * Serves or removes one stored file. Access is re-derived from what the file
 * is attached to on every request — a file is never public, and knowing its
 * id is not permission. (Organization isolation: the data layer.)
 */
async function resolve(principal: Parameters<typeof taskAccess>[0], id: string, mode: "read" | "write") {
  const file = await prisma.file.findUnique({ where: { id } });
  if (!file?.taskId) return { error: apiError("That file no longer exists", 404) };
  const access = await taskAccess(principal, file.taskId, mode);
  if (!access.ok) return { error: apiError(access.error, access.status === 403 ? 403 : 404) };
  return { file };
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("read", "file");
  if (gate.response) return gate.response;
  const { file, error } = await resolve(gate.principal, params.id, "read");
  if (error) return error;

  const bytes = await read(file.storedName);
  if (!bytes) return apiError("That file is missing from storage", 404);
  const safeName = file.filename.replace(/[^\w.\- ]+/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("delete", "file");
  if (gate.response) return gate.response;
  const { file, error } = await resolve(gate.principal, params.id, "write");
  if (error) return error;

  await prisma.file.delete({ where: { id: file.id } });
  return NextResponse.json({ ok: true });
}
