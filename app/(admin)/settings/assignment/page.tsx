import type { Metadata } from "next";

import { AssignmentSettingsForm } from "@/components/settings/AssignmentSettingsForm";

export const metadata: Metadata = { title: "Assignment" };

/** How projects are staffed: the mode, the scoring weights, a role's weekly load. Founder-only (settings layout). */
export default function AssignmentSettingsPage() {
  return <AssignmentSettingsForm />;
}
