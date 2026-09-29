import Link from "next/link";
import { FileBarChart2 } from "lucide-react";

import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

/** A report that isn't this account's, or not published: the same answer either way. */
export default function PortalReportNotFound() {
  return (
    <Card padded={false}>
      <EmptyState
        icon={FileBarChart2}
        title="This report isn't available"
        description="The link may be out of date. Your reports are all in your reports library."
        action={
          <Link href="/portal/reports" className={buttonClasses("primary", "md")}>
            Your reports
          </Link>
        }
      />
    </Card>
  );
}
