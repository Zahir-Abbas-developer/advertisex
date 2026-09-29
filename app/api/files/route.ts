import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { MAX_UPLOAD_BYTES, isAllowedFile, save } from "@/lib/uploads";
import { requireApi } from "@/modules/rbac/server";
import { FILE_VISIBILITIES, ownerAccess, ownerFromQuery, ownerWhere, toView, type FileVisibility } from "@/modules/files/server";
import { limited } from "@/lib/rate-limit";

/**
 * Files on a client, project or contract (Phase 4 scope 5).
 *
 *   GET  ?clientId= | ?projectId= | ?contractId=   → the files, with signed URLs
 *   POST multipart: file, one owner id, visibility → upload
 *
 * Access follows the owner; a client login lists only client-visible files.
 */
export async function GET(request: Request) {
  const gate = await requireApi("read", "file");
  if (gate.response) return gate.response;
  const owner = ownerFromQuery(new URL(request.url).searchParams);
  if (!owner) return apiError("Say whose files: clientId, projectId or contractId", 400);
  const access = await ownerAccess(gate.principal, owner, "read");
  if (!access.ok) return apiError("Not found", 404);

  const files = await prisma.file.findMany({
    where: { ...ownerWhere(owner), ...(gate.principal.role === "CLIENT" ? { visibility: "CLIENT" } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { uploader: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ files: files.map(toView) });
}

export async function POST(request: Request) {
  const gate = await requireApi("create", "file");
  if (gate.response) return gate.response;
  const throttled = limited("uploads", gate.principal.id);
  if (throttled) return throttled;
  if (!gate.principal.organizationId) return apiError("Your account has no organization", 403);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("Expected a file upload", 400);
  }
  const owner = ownerFromQuery(form);
  if (!owner) return apiError("Attach the file to one client, project or contract", 400);
  const access = await ownerAccess(gate.principal, owner, "write");
  if (!access.ok) return apiError("Not found", 404);

  const visibility = String(form.get("visibility") ?? "INTERNAL") as FileVisibility;
  if (!FILE_VISIBILITIES.includes(visibility)) return apiError("Visibility is INTERNAL or CLIENT", 422, { visibility: "Pick who can see it" });
  // Sharing with the client is the founder's and managers' call, on upload as on change.
  if (visibility === "CLIENT" && gate.principal.role === "EMPLOYEE") {
    return apiError("Only the founder and managers share files with the client", 403, { visibility: "Upload it as internal" });
  }

  const upload = form.get("file");
  if (!(upload instanceof File) || upload.size === 0) return apiError("Choose a file to upload", 422, { file: "No file received" });
  if (upload.size > MAX_UPLOAD_BYTES) {
    return apiError(`That file is ${formatBytes(upload.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`, 413, { file: "Too large" });
  }
  if (!(await isAllowedFile(upload))) {
    return apiError(`${upload.type || "That file type"} isn't accepted. Images, PDFs, documents and archives are.`, 415, { file: "Unsupported type" });
  }

  const storedName = await save(randomUUID(), upload.type, Buffer.from(await upload.arrayBuffer()));
  const file = await prisma.file.create({
    data: {
      organizationId: gate.principal.organizationId,
      uploaderId: gate.principal.id,
      ...ownerWhere(owner),
      filename: upload.name.slice(0, 200) || "file",
      storedName,
      mimeType: upload.type,
      size: upload.size,
      visibility,
    },
    include: { uploader: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ file: toView(file) }, { status: 201 });
}
