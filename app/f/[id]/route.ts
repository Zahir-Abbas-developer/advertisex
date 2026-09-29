import { prisma } from "@/lib/prisma";
import { read } from "@/lib/uploads";
import { fileUrlSecret } from "@/modules/files/server";
import { canPreview, contentDisposition, verifyFileSignature } from "@/modules/files/signing";

/**
 * The bytes behind a signed file URL (Phase 4 scope 5). Access was decided
 * when the URL was issued; this checks only the signature and the expiry —
 * the contract of an S3 presigned URL, so a bucket can replace this route
 * without changing who gets a URL.
 *
 * Outside the middleware's matcher on purpose: a signed URL works in an
 * <img> tag or a new tab without a session cookie.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get("e"));
  const disposition = url.searchParams.get("d") ?? "";
  const signature = url.searchParams.get("s") ?? "";

  const valid = verifyFileSignature({ fileId: params.id, expires, disposition, signature, secret: fileUrlSecret(), now: Date.now() });
  if (!valid) return new Response("This link has expired. Open the file again from the app.", { status: 403 });

  const file = await prisma.file.findUnique({ where: { id: params.id }, select: { storedName: true, filename: true, mimeType: true } });
  if (!file) return new Response("Not found", { status: 404 });
  const bytes = await read(file.storedName);
  if (!bytes) return new Response("Not found", { status: 404 });

  const inline = disposition === "inline" && canPreview(file.mimeType);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", file.filename),
      "X-Content-Type-Options": "nosniff",
      // Rendered, never executed: no scripts, no plugins, no navigation.
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; object-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, max-age=300",
      "Referrer-Policy": "no-referrer",
    },
  });
}
