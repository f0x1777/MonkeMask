import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";

import { decrypt, deriveKEK, encrypt, generateDataKey, unwrapKey, wrapKey } from "./crypto";

// The fixed message an ambassador signs to unlock their vault. Constant so the
// derived KEK is reproducible across sessions.
const VAULT_MSG = new TextEncoder().encode(
  "MonkeMask v2 — derive my vault key. Only sign this in the official app.",
);

describe("wallet-signature determinism spike (Task 1)", () => {
  it("ed25519 signing of a fixed message is deterministic", () => {
    const kp = nacl.sign.keyPair();
    const a = nacl.sign.detached(VAULT_MSG, kp.secretKey);
    const b = nacl.sign.detached(VAULT_MSG, kp.secretKey);
    // Determinism is the load-bearing assumption of the whole envelope scheme.
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("a re-derived KEK unwraps the country key and decryption round-trips", async () => {
    const kp = nacl.sign.keyPair();
    const kek1 = await deriveKEK(nacl.sign.detached(VAULT_MSG, kp.secretKey));
    const ck = await generateDataKey();
    const { iv, wrapped } = await wrapKey(kek1, ck);

    // Next session: re-sign, re-derive the KEK, unwrap the same CK.
    const kek2 = await deriveKEK(nacl.sign.detached(VAULT_MSG, kp.secretKey));
    const ck2 = await unwrapKey(kek2, wrapped, iv);

    const e = await encrypt(ck, new TextEncoder().encode("face->monke association"));
    const back = await decrypt(ck2, e.ciphertext, e.iv);
    expect(new TextDecoder().decode(back)).toBe("face->monke association");
  });

  it("a different wallet cannot unwrap another ambassador's country key", async () => {
    const a = nacl.sign.keyPair();
    const b = nacl.sign.keyPair();
    const kekA = await deriveKEK(nacl.sign.detached(VAULT_MSG, a.secretKey));
    const kekB = await deriveKEK(nacl.sign.detached(VAULT_MSG, b.secretKey));
    const { iv, wrapped } = await wrapKey(kekA, await generateDataKey());
    await expect(unwrapKey(kekB, wrapped, iv)).rejects.toThrow();
  });
});

describe("envelope-encryption primitives (Task 6)", () => {
  it("encrypt/decrypt round-trips", async () => {
    const key = await generateDataKey();
    const { iv, ciphertext } = await encrypt(key, new TextEncoder().encode("secret roster row"));
    const back = await decrypt(key, ciphertext, iv);
    expect(new TextDecoder().decode(back)).toBe("secret roster row");
  });

  it("tampered ciphertext fails authentication", async () => {
    const key = await generateDataKey();
    const { iv, ciphertext } = await encrypt(key, new TextEncoder().encode("x"));
    const bad = new Uint8Array(ciphertext);
    bad[0] ^= 0xff;
    await expect(decrypt(key, bad, iv)).rejects.toThrow();
  });

  it("two CKs are independent (wrong key cannot decrypt)", async () => {
    const k1 = await generateDataKey();
    const k2 = await generateDataKey();
    const { iv, ciphertext } = await encrypt(k1, new TextEncoder().encode("y"));
    await expect(decrypt(k2, ciphertext, iv)).rejects.toThrow();
  });
});
