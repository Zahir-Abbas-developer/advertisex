import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { storedRoleValues, type Role } from "@/config/permissions";
import { requireApi } from "@/modules/rbac/server";

const WORKERS: Role[] = ["FOUNDER", "MANAGER", "EMPLOYEE", "AI_AGENT"];

/**
 * Who can be put on a project, for the team pickers: name, title and skills
 * only — nothing a planner shouldn't see. The founder and managers plan
 * projects, so only they get the list.
 */
export async function GET() {
  const gate = await requireApi("create", "project");
  if (gate.response) return gate.response;
  if (gate.principal.role === "EMPLOYEE") return apiError("You don't plan projects", 403);

  const people = await prisma.user.findMany({
    where: { isActive: true, role: { in: WORKERS.flatMap(storedRoleValues) } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      jobTitle: true,
      avatarColor: true,
      role: true,
      skills: { select: { proficiency: true, skill: { select: { id: true, name: true } } } },
    },
  });
  return NextResponse.json({
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      jobTitle: p.jobTitle,
      avatarColor: p.avatarColor,
      isAgent: p.role === "AI_AGENT",
      skills: p.skills.map((s) => ({ id: s.skill.id, name: s.skill.name, proficiency: s.proficiency })),
    })),
  });
}
