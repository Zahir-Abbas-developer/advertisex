import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { canShapeProject, notifyTeam, projectFor } from "@/modules/projects/server";

/** The project's discussion thread, for the team (clients see shared comments in the portal only). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("read", "project");
  if (gate.response) return gate.response;
  if (gate.principal.role === "CLIENT") return apiError("Not found", 404);
  const found = await projectFor(gate.principal, params.id, "read");
  if (!found.project) return apiError("That project doesn't exist", 404);

  const comments = await prisma.projectComment.findMany({
    where: { projectId: params.id },
    orderBy: { createdAt: "asc" },
    take: 300,
    select: { id: true, body: true, visibility: true, createdAt: true, author: { select: { id: true, name: true, avatarColor: true } } },
  });
  return NextResponse.json({ comments });
}

const schema = z
  .object({
    body: z.string().trim().min(1, "Write something").max(4000),
    /** Phase 6: explicit visibility. Internal unless deliberately shared. */
    visibility: z.enum(["INTERNAL", "CLIENT"]).default("INTERNAL"),
  })
  .strict();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  if (gate.principal.role === "CLIENT") return apiError("Not found", 404);
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, { body: "Write something" });
  if (parsed.data.visibility === "CLIENT" && !canShapeProject(gate.principal, found.project)) {
    return apiError("Only the founder and managers share comments with the client", 403);
  }
  const comment = await prisma.projectComment.create({
    data: { projectId: params.id, authorId: gate.principal.id, body: parsed.data.body, visibility: parsed.data.visibility },
    select: { id: true, body: true, visibility: true, createdAt: true, author: { select: { id: true, name: true, avatarColor: true } } },
  });
  await notifyTeam(params.id, gate.principal.id, {
    type: "PROJECT_UPDATED",
    title: `${comment.author?.name ?? "Someone"} commented on ${found.project.title}`,
    body: parsed.data.body.slice(0, 140),
  });
  return NextResponse.json({ comment }, { status: 201 });
}
