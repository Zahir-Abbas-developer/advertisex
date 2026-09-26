import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { ReportsBrowser } from "@/components/reports/ReportsBrowser";

import { storedRoleValues } from "@/config/permissions";
export const metadata: Metadata = {
  title: "Reports",
};

export default async function ReportsPage() {
  await requireAdmin();

  const members = await prisma.user.findMany({
    where: { role: { in: storedRoleValues("EMPLOYEE") } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return <ReportsBrowser isAdmin members={members} />;
}
