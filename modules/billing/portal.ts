/**
 * Invoices for the client portal (Phase 6 scope 5) — read-only, own only.
 *
 * Invoicing is Phase 7. Until then this is the one seam the portal reads
 * through, and it returns nothing: the portal shows an honest empty state,
 * and Phase 7 replaces the body of `invoicesForAccount` without the portal
 * changing. The shape below is the contract.
 */
export type PortalInvoice = {
  id: string;
  number: string;
  issuedAt: string;
  dueAt: string | null;
  /** Whole currency units. */
  total: number;
  currency: string;
  /** "OPEN" | "PAID" | "OVERDUE" | "VOID" */
  status: string;
  downloadUrl: string | null;
};

export async function invoicesForAccount(clientAccountId: string): Promise<PortalInvoice[]> {
  void clientAccountId;
  return [];
}
