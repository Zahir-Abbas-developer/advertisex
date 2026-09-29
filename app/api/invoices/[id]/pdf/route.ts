import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { invoiceDocument, invoiceForStaff } from "@/modules/billing/server";
import { pdfFileName, renderInvoicePdf } from "@/modules/billing/pdf";

/** The invoice as a PDF, for the founder (a draft renders as "Draft invoice"). `?download=1` saves it. */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "invoice");
  if (gate.response) return gate.response;
  const inv = await invoiceForStaff(gate.principal, params.id);
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
