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
