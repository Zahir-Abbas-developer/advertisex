import Link from "next/link";
import { Receipt } from "lucide-react";

import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

/** An invoice that isn't this account's (or a draft): the same answer either way. */
export default function PortalInvoiceNotFound() {
  return (
    <Card padded={false}>
      <EmptyState
        icon={Receipt}
        title="This invoice isn't available"
        description="The link may be out of date. Your invoices are all listed on the invoices page."
        action={
          <Link href="/portal/invoices" className={buttonClasses("primary", "md")}>
            Your invoices
          </Link>
        }
      />
    </Card>
  );
}
