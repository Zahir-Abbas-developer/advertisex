import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { read, remove } from "@/lib/uploads";
import { authorize } from "@/modules/rbac/authorize";
import { requireApi } from "@/modules/rbac/server";
import { FILE_VISIBILITIES, fileFor, toView } from "@/modules/files/server";

/**
 * One stored file. Access is re-derived from what the file is attached to on
 * every request — a file is never public, and knowing its id is not
 * permission. (Organization isolation: the data layer.)
 *
 *   GET     the bytes, as a download (the task drawer's link)
 *   PATCH   { visibility } — who may see it
 *   DELETE  the row and its bytes
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("read", "file");
  if (gate.response) return gate.response;
  const file = await fileFor(gate.principal, params.id, "read");
  if (!file) return apiError("That file no longer exists", 404);

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

const patchSchema = z.object({ visibility: z.enum(FILE_VISIBILITIES) }).strict();

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("create", "file");
  if (gate.response) return gate.response;
  if (gate.principal.role === "EMPLOYEE") return apiError("Only the founder and managers change who can see a file", 403);
  const file = await fileFor(gate.principal, params.id, "write");
  if (!file) return apiError("That file no longer exists", 404);
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Visibility is INTERNAL or CLIENT", 422, { visibility: "Pick who can see it" });

  const updated = await prisma.file.update({
    where: { id: file.id },
    data: { visibility: parsed.data.visibility },
    include: { uploader: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ file: toView(updated) });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("delete", "file");
  if (gate.response) return gate.response;
  const file = await fileFor(gate.principal, params.id, "write");
  if (!file) return apiError("That file no longer exists", 404);
  // An employee removes only what they uploaded (the matrix's "own").
  if (!authorize(gate.principal, "delete", "file", { ownerId: file.uploaderId }).allowed) {
    return apiError("Only whoever uploaded it, or a manager, can remove it", 403);
  }

  await prisma.file.delete({ where: { id: file.id } });
  await remove(file.storedName);
  return NextResponse.json({ ok: true });
}
