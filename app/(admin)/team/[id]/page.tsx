import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { EmployeeProfile } from "@/components/team/EmployeeProfile";
import { requirePage } from "@/modules/rbac/server";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const member = await prisma.user.findUnique({ where: { id: params.id }, select: { name: true } });
  return { title: member?.name ?? "Team member" };
}

/**
 * An employee's profile — Phase 2 scope 1. (Replaces the parked scoring
 * module's profile that lived here; that module stays parked.) The API
 * applies the directory scope, so a manager outside the person's departments
 * gets "not on your team".
 */
export default async function TeamMemberPage({ params }: { params: { id: string } }) {
  await requirePage("read", "ops");
  return <EmployeeProfile id={params.id} />;
}
