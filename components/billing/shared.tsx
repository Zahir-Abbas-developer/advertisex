import { Badge } from "@/components/ui/Badge";
import { CLIENT_INVOICE_STATUS_LABEL, INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, type InvoiceStatus } from "@/modules/billing/domain";

export { formatMoney } from "@/modules/billing/money";

export function InvoiceStatusBadge({ status, size = "sm", forClient = false }: { status: InvoiceStatus; size?: "sm" | "md"; forClient?: boolean }) {
  return (
    <Badge size={size} tone={INVOICE_STATUS_TONE[status]} dot={status === "OVERDUE"}>
      {(forClient ? CLIENT_INVOICE_STATUS_LABEL : INVOICE_STATUS_LABEL)[status]}
    </Badge>
  );
}

export type InvoiceRow = {
  id: string;
  numberLabel: string | null;
  status: InvoiceStatus;
  client: { id: string; businessName: string };
  project: { id: string; title: string } | null;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  issueDate: string | null;
  dueDate: string;
};

/** A fresh key per attempt: the same dialog retried sends the same key, so a payment records once. */
export const newIdempotencyKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** "YYYY-MM-DD" of a local date, for date inputs. */
export const localDateKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
