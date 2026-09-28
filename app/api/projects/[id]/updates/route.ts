import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { canShapeProject, projectFor } from "@/modules/projects/server";
import { notifyUpdateShared } from "@/modules/portal/server";

/**
 * Project updates (Phase 6 scope 3). Every update carries an explicit
 * visibility: CLIENT updates appear in the portal, INTERNAL ones never do.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("read", "project");
  if (gate.response) return gate.response;
  if (gate.principal.role === "CLIENT") return apiError("Not found", 404);
  const found = await projectFor(gate.principal, params.id, "read");
  if (!found.project) return apiError("That project doesn't exist", 404);
  const updates = await prisma.projectUpdate.findMany({
    where: { projectId: params.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, title: true, body: true, visibility: true, createdAt: true, author: { select: { id: true, name: true, avatarColor: true } } },
  });
  return NextResponse.json({ updates, viewer: { canShare: canShapeProject(gate.principal, found.project) } });
}

const schema = z
  .object({
    title: z.string().trim().min(2, "Give the update a headline").max(120),
    body: z.string().trim().min(1, "Write the update").max(4000),
    visibility: z.enum(["INTERNAL", "CLIENT"]),
  })
  .strict();

/**
 * Anyone on the project posts an internal update; sharing with the client is
 * the founder's and managers' call, like sharing a file.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  if (gate.principal.role === "CLIENT") return apiError("Not found", 404);
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  if (parsed.data.visibility === "CLIENT" && !canShapeProject(gate.principal, found.project)) {
    return apiError("Only the founder and managers share updates with the client", 403, { visibility: "Post it as internal" });
  }
  const update = await prisma.projectUpdate.create({
    data: { projectId: params.id, authorId: gate.principal.id, ...parsed.data },
    select: { id: true, visibility: true },
  });
  if (update.visibility === "CLIENT") await notifyUpdateShared(params.id, parsed.data.title);
  return NextResponse.json({ update }, { status: 201 });
}
