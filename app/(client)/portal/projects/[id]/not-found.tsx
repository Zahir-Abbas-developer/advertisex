import Link from "next/link";
import { FolderKanban } from "lucide-react";

import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

/** A project that isn't this account's, or no longer exists: the same answer either way. */
export default function PortalProjectNotFound() {
  return (
    <Card padded={false}>
      <EmptyState
        icon={FolderKanban}
        title="This project isn't available"
        description="The link may be out of date. Your projects are all listed on the projects page."
        action={
          <Link href="/portal/projects" className={buttonClasses("primary", "md")}>
            Your projects
          </Link>
        }
      />
    </Card>
  );
}
