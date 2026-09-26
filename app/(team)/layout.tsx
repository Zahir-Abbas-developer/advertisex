import type { ReactNode } from "react";

import { StaffLayout } from "@/components/layout/StaffLayout";

/**
 * Screens every staff role works in. The shell's experience — command center
 * or team — follows the viewer's role, so a founder here still sees theirs.
 */
export default function TeamLayout({ children }: { children: ReactNode }) {
  return <StaffLayout>{children}</StaffLayout>;
}
