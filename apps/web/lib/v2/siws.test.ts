import bs58 from "bs58";
import nacl from "tweetnacl";
import { describe, it, expect } from "vitest";

import { buildSiwsMessage, verifySiws } from "./siws";

const sign = (msg: string, secret: Uint8Array) =>
  bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), secret));

describe("SIWS verify (Task 4 core)", () => {
  it("verifies a valid signature over the SIWS message", () => {
    const kp = nacl.sign.keyPair();
    const pubkey = bs58.encode(kp.publicKey);
    const msg = buildSiwsMessage(pubkey, "abc123");
    expect(verifySiws(msg, sign(msg, kp.secretKey), pubkey)).toBe(true);
  });

  it("rejects a signature from a different wallet", () => {
    const a = nacl.sign.keyPair();
    const b = nacl.sign.keyPair();
    const pubA = bs58.encode(a.publicKey);
    const msg = buildSiwsMessage(pubA, "n");
    expect(verifySiws(msg, sign(msg, b.secretKey), pubA)).toBe(false);
  });

  it("rejects when the message was tampered (e.g. a swapped nonce)", () => {
    const kp = nacl.sign.keyPair();
    const pubkey = bs58.encode(kp.publicKey);
    const sig = sign(buildSiwsMessage(pubkey, "n1"), kp.secretKey);
    expect(verifySiws(buildSiwsMessage(pubkey, "n2"), sig, pubkey)).toBe(false);
  });

  it("returns false (never throws) on malformed input", () => {
    expect(verifySiws("m", "not-base58-0OIl", "also-bad")).toBe(false);
  });

  it("builds a stable message containing the pubkey and nonce", () => {
    const m = buildSiwsMessage("WALLET", "NONCE");
    expect(m).toContain("WALLET");
    expect(m).toContain("Nonce: NONCE");
  });
});
