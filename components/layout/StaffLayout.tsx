import type { ReactNode } from "react";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/layout/AppShell";
import { unseenErrorCount } from "@/lib/system-errors";
import { getModuleFlags, hiddenNavKeys } from "@/lib/modules";
import { DEFAULT_LANDING, experienceFor } from "@/lib/routes";
import { requireStaffPage } from "@/modules/rbac/server";
import type { Role } from "@/config/permissions";

/**
 * The staff shell, shared by the (admin) and (team) route groups.
 *
 * Which *experience* renders — the command center or the team shell —
 * follows the person's role, not the URL: a founder opening the shared
 * pipeline is still in the command center. The route group decides who may
 * open a page at all; `onlyRoles` narrows it further for the (admin) group.
 *
 * Every check here is server-side and repeated regardless of middleware.
 */
export async function StaffLayout({
  children,
  onlyRoles,
}: {
  children: ReactNode;
  onlyRoles?: readonly Role[];
}) {
  const principal = await requireStaffPage();
  if (onlyRoles && !onlyRoles.includes(principal.role)) redirect(`${DEFAULT_LANDING}?denied=admin`);

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
  const errorBadge =
    principal.role === "FOUNDER" || principal.role === "MANAGER" ? await unseenErrorCount() : 0;
  // Resolved here rather than in the rail: the nav is a client component, and
  // a parked module must never flicker into view while a fetch resolves.
  const flags = await getModuleFlags();

  return (
    <AppShell
      experience={experienceFor(principal.role)}
      errorBadge={errorBadge}
      hiddenNavKeys={hiddenNavKeys(flags)}
      attendanceEnabled={flags.attendance}
      user={{
        name: user.name ?? "Team member",
        role: principal.role,
        jobTitle: user.jobTitle,
        avatarColor: user.avatarColor,
      }}
    >
      {children}
    </AppShell>
  );
}
