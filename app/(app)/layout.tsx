import type { ReactNode } from "react";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { requireStaffPage } from "@/modules/rbac/server";
import { AppShell } from "@/components/layout/AppShell";
import { unseenErrorCount } from "@/lib/system-errors";
import { getModuleFlags, hiddenNavKeys } from "@/lib/modules";

/**
 * The team shell. Middleware already rejects anonymous traffic and routes a
 * CLIENT to the portal; `requireStaffPage` enforces both again on the server,
 * so no team screen can render for a CLIENT or an AI_AGENT even if a matcher
 * is ever mis-typed.
 */
export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const principal = await requireStaffPage();
  const user = await requireUser();

  // A seeded placeholder credential must not survive first contact with a real
  // user, so this gate comes before any app surface renders. Read from the
  // database, not the session: a token minted before the change would keep
  // claiming the password still needs changing.
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { mustChangePassword: true },
  });
  if (account?.mustChangePassword) redirect("/change-password");

  // Only the roles that hold the error log pay for its count.
  const errorBadge = principal.role === "FOUNDER" || principal.role === "MANAGER" ? await unseenErrorCount() : 0;
  // Resolved here rather than in the rail: the nav is a client component, and
  // a parked module must never flicker into view while a fetch resolves.
  const flags = await getModuleFlags();

  return (
    <AppShell
      errorBadge={errorBadge}
      hiddenNavKeys={hiddenNavKeys(flags)}
      attendanceEnabled={flags.attendance}
      user={{
        name: user.name ?? "Team member",
        role: user.role,
        jobTitle: user.jobTitle,
        avatarColor: user.avatarColor,
      }}
    >
      {children}
    </AppShell>
  );
}
