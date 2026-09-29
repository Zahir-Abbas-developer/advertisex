import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { MAX_UPLOAD_BYTES, isAllowedType, save } from "@/lib/uploads";
import { requireApi } from "@/modules/rbac/server";
import { taskAccess } from "@/modules/tasks/server";

/**
 * Files attached to a task. Validated (type, size), stored under a generated
 * name, and only ever served back through /api/files/[id], which re-checks
 * access. Anyone who can see the task can attach; its owners can remove.
 */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "file");
  if (gate.response) return gate.response;
  const access = await taskAccess(gate.principal, params.id, "read");
  if (!access.ok) return apiError(access.error, access.status);

  const files = await prisma.file.findMany({
    where: { taskId: params.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, filename: true, mimeType: true, size: true, createdAt: true, uploader: { select: { name: true } } },
  });
  return NextResponse.json({ files });
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("create", "file");
  if (gate.response) return gate.response;
  const access = await taskAccess(gate.principal, params.id, "read");
  if (!access.ok) return apiError(access.error, access.status);
  if (!gate.principal.organizationId) return apiError("Your account has no organization", 403);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("Expected a file upload", 400);
  }
  const upload = form.get("file");
  if (!(upload instanceof File) || upload.size === 0) {
    return apiError("Choose a file to upload", 422, { file: "No file received" });
  }
  if (upload.size > MAX_UPLOAD_BYTES) {
    return apiError(`That file is ${formatBytes(upload.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`, 413, { file: "Too large" });
  }
  if (!isAllowedType(upload.type)) {
    return apiError(`${upload.type || "That file type"} isn't accepted. Images, PDFs, documents and archives are.`, 415, { file: "Unsupported type" });
  }

  const storedName = await save(randomUUID(), upload.type, Buffer.from(await upload.arrayBuffer()));
  const file = await prisma.file.create({
    data: {
      organizationId: gate.principal.organizationId,
      uploaderId: gate.principal.id,
      taskId: params.id,
      filename: upload.name.slice(0, 200) || "file",
      storedName,
      mimeType: upload.type,
      size: upload.size,
    },
    select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
  });
  return NextResponse.json({ file }, { status: 201 });
}
