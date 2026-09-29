import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { MAX_UPLOAD_BYTES, isAllowedFile, save } from "@/lib/uploads";
import { requireApi } from "@/modules/rbac/server";
import { messagesFor, post, threadFor } from "@/modules/messages/server";
import { limited } from "@/lib/rate-limit";

/** A thread's messages (marks it read). Unknown, or not yours: 404. */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "message");
  if (gate.response) return gate.response;
  const t = await threadFor(gate.principal, params.id);
  if (!t) return apiError("Not found", 404);
  const messages = await messagesFor(gate.principal, t.id);
  return NextResponse.json({
    thread: { id: t.id, kind: t.kind, subject: t.subject, client: { id: t.client.id, businessName: t.client.businessName } },
    messages,
  });
}

const MAX_FILES = 5;

/** Posts a message, with up to five files (multipart: body, file…). */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("create", "message");
  if (gate.response) return gate.response;
  const throttled = limited("messages", gate.principal.id);
  if (throttled) return throttled;
  const t = await threadFor(gate.principal, params.id);
  if (!t) return apiError("Not found", 404);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("Expected a message", 400);
  }
  const body = String(form.get("body") ?? "").trim();
  const uploads = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (!body && uploads.length === 0) return apiError("Write a message or attach a file", 422, { body: "Write something" });
  if (body.length > 5000) return apiError("That message is too long", 422, { body: "At most 5,000 characters" });
  if (uploads.length > MAX_FILES) return apiError(`At most ${MAX_FILES} files per message`, 422);
  for (const f of uploads) {
    if (f.size > MAX_UPLOAD_BYTES) return apiError(`${f.name} is ${formatBytes(f.size)}; the limit is ${formatBytes(MAX_UPLOAD_BYTES)}`, 413);
    if (!(await isAllowedFile(f))) return apiError(`${f.name} isn't a type we accept`, 415);
  }

  const message = await post(gate.principal, t, body || "Shared a file");
  for (const f of uploads) {
    const storedName = await save(randomUUID(), f.type, Buffer.from(await f.arrayBuffer()));
    await prisma.file.create({
      data: {
        organizationId: t.organizationId,
        uploaderId: gate.principal.id,
        messageId: message.id,
        filename: f.name.slice(0, 200) || "file",
        storedName,
        mimeType: f.type,
        size: f.size,
        // Shared in a conversation with the client, so visible to it.
        visibility: "CLIENT",
      },
    });
  }
  return NextResponse.json({ message: { id: message.id } }, { status: 201 });
}
