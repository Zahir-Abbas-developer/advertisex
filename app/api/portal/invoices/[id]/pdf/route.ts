import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { invoiceDocument, invoiceForClient } from "@/modules/billing/server";
import { pdfFileName, renderInvoicePdf } from "@/modules/billing/pdf";

/** The account's invoice as a PDF — the same document the client was emailed. */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("read", "invoice");
  if (gate.response) return gate.response;
  const inv = await invoiceForClient(gate.principal, params.id);
  if (!inv) return apiError("Not found", 404);
  const doc = await invoiceDocument(inv);
  const bytes = await renderInvoicePdf(doc);
  const disposition = new URL(request.url).searchParams.get("download") ? "attachment" : "inline";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${pdfFileName(doc, inv.id)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
