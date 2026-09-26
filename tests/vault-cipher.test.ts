import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { keyIdOf, open, parseKey, seal, VaultError } from "../modules/vault/cipher";
import { vaultKeys } from "../modules/vault/keys";

const key = randomBytes(32);
const other = randomBytes(32);

describe("vault cipher — AES-256-GCM, bound to its record", () => {
  it("round-trips a secret", () => {
    const sealed = seal("hunter2 — ünïcode ok", key, "cred-1");
    assert.equal(open(sealed, [key], "cred-1"), "hunter2 — ünïcode ok");
  });

  it("never contains the plaintext, and differs every time (fresh IV)", () => {
    const a = seal("s3cret-password", key, "cred-1");
    const b = seal("s3cret-password", key, "cred-1");
    assert.ok(!a.includes("s3cret"));
    assert.ok(!Buffer.from(a.split(".")[4], "base64url").toString("utf8").includes("s3cret"));
    assert.notEqual(a, b);
    assert.match(a, /^v1\.[0-9a-f]{8}\./);
  });

  it("refuses a value moved to another record", () => {
    const sealed = seal("pw", key, "cred-1");
    assert.throws(() => open(sealed, [key], "cred-2"), VaultError);
  });

  it("refuses any tampering with the ciphertext or tag", () => {
    const parts = seal("pw-long-enough", key, "cred-1").split(".");
    const flip = (s: string) => {
      const buf = Buffer.from(s, "base64url");
      buf[0] ^= 1;
      return buf.toString("base64url");
    };
    assert.throws(() => open([...parts.slice(0, 4), flip(parts[4])].join("."), [key], "cred-1"), VaultError);
    assert.throws(() => open([...parts.slice(0, 3), flip(parts[3]), parts[4]].join("."), [key], "cred-1"), VaultError);
  });

  it("opens with the right key among several (rotation), refuses an unknown one", () => {
    const sealed = seal("pw", other, "cred-1");
    assert.equal(open(sealed, [key, other], "cred-1"), "pw");
    assert.throws(() => open(sealed, [key], "cred-1"), /key this server doesn't hold/);
    assert.notEqual(keyIdOf(key), keyIdOf(other));
  });

  it("rejects malformed values and keys", () => {
    assert.throws(() => open("plain text", [key], "x"), VaultError);
    assert.throws(() => parseKey(Buffer.alloc(16).toString("base64")), VaultError);
    assert.equal(parseKey(key.toString("base64")).length, 32);
  });
});

describe("vault keys", () => {
  it("uses VAULT_KEY, and the previous key during a rotation", () => {
    const k1 = randomBytes(32).toString("base64");
    const k2 = randomBytes(32).toString("base64");
    const out = vaultKeys({ VAULT_KEY: k1, VAULT_KEY_PREVIOUS: k2, NODE_ENV: "production" } as NodeJS.ProcessEnv);
    assert.equal(out.keys.length, 2);
    assert.equal(out.development, false);
  });

  it("refuses to run production without a key", () => {
    assert.throws(() => vaultKeys({ NODE_ENV: "production" } as NodeJS.ProcessEnv), /VAULT_KEY is not set/);
  });

  it("falls back to a development key outside production", () => {
    const out = vaultKeys({ NODE_ENV: "development", NEXTAUTH_SECRET: "x" } as NodeJS.ProcessEnv);
    assert.equal(out.development, true);
    assert.equal(out.keys[0].length, 32);
  });
});
