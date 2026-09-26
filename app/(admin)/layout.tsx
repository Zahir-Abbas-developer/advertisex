import type { ReactNode } from "react";

import { StaffLayout } from "@/components/layout/StaffLayout";

/**
 * The command center's own screens — founder configuration and the ops logs.
 * No EMPLOYEE reaches any page in this group; each page then narrows further
 * (most are FOUNDER-only; the audit and error logs admit MANAGER).
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <StaffLayout onlyRoles={["FOUNDER", "MANAGER"]}>{children}</StaffLayout>;
}
