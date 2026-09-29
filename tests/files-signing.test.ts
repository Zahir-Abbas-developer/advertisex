import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { canPreview, signFile, verifyFileSignature } from "../modules/files/signing";

const secret = randomBytes(32);
const now = Date.parse("2026-09-26T12:00:00Z");
const expires = now / 1000 + 300;

describe("signed file URLs", () => {
  it("verifies a URL it issued, until it expires", () => {
    const signature = signFile("file-1", expires, "inline", secret);
    assert.ok(verifyFileSignature({ fileId: "file-1", expires, disposition: "inline", signature, secret, now }));
    assert.ok(!verifyFileSignature({ fileId: "file-1", expires, disposition: "inline", signature, secret, now: (expires + 1) * 1000 }));
  });

  it("is bound to the file, the disposition, the expiry and the secret", () => {
    const signature = signFile("file-1", expires, "inline", secret);
    assert.ok(!verifyFileSignature({ fileId: "file-2", expires, disposition: "inline", signature, secret, now }));
    assert.ok(!verifyFileSignature({ fileId: "file-1", expires, disposition: "attachment", signature, secret, now }));
    assert.ok(!verifyFileSignature({ fileId: "file-1", expires: expires + 3600, disposition: "inline", signature, secret, now }));
    assert.ok(!verifyFileSignature({ fileId: "file-1", expires, disposition: "inline", signature, secret: randomBytes(32), now }));
  });

  it("rejects malformed input", () => {
    const signature = signFile("file-1", expires, "inline", secret);
    assert.ok(!verifyFileSignature({ fileId: "file-1", expires, disposition: "script", signature, secret, now }));
    assert.ok(!verifyFileSignature({ fileId: "file-1", expires: Number.NaN, disposition: "inline", signature, secret, now }));
    assert.ok(!verifyFileSignature({ fileId: "file-1", expires, disposition: "inline", signature: "short", secret, now }));
  });

  it("previews only types a browser renders safely", () => {
    assert.ok(canPreview("image/png") && canPreview("application/pdf"));
    assert.ok(!canPreview("text/html") && !canPreview("image/svg+xml") && !canPreview("application/zip"));
  });
});

describe("content disposition", () => {
  it("is always a valid header, with the exact name in UTF-8", async () => {
    const { contentDisposition } = await import("../modules/files/signing");
    const h = contentDisposition("attachment", "Osteria Nonna — Monthly report — August 2026.pdf");
    assert.ok([...h].every((c) => c.charCodeAt(0) < 128), "ASCII only — never throws in a header");
    assert.match(h, /^attachment; filename="Osteria Nonna Monthly report August 2026\.pdf"; filename\*=UTF-8''Osteria%20Nonna%20%E2%80%94%20Monthly/);
    assert.equal(contentDisposition("inline", "Menú.pdf"), `inline; filename="Menu.pdf"; filename*=UTF-8''Men%C3%BA.pdf`);
    assert.match(contentDisposition("attachment", 'a"b\\c.pdf'), /filename="a_b_c\.pdf"/);
    assert.match(contentDisposition("attachment", "🍝"), /filename="file"/);
  });
});
