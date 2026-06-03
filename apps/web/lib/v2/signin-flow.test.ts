import bs58 from "bs58";
import nacl from "tweetnacl";
import { describe, it, expect } from "vitest";

import { performSignIn } from "./signin-flow";

// Deterministic signer backed by a real ed25519 keypair.
function realSigner() {
  const kp = nacl.sign.keyPair();
  return {
    pubkey: bs58.encode(kp.publicKey),
    signMessage: async (m: Uint8Array) => nacl.sign.detached(m, kp.secretKey),
  };
}

function fakeFetch(verifyResponse: { status: number; body: unknown }): typeof fetch {
  return (async (url: string) => {
    if (String(url).endsWith("/nonce")) {
      return { ok: true, json: async () => ({ nonce: "test-nonce" }) } as Response;
    }
    return {
      ok: verifyResponse.status === 200,
      status: verifyResponse.status,
      json: async () => verifyResponse.body,
    } as Response;
  }) as unknown as typeof fetch;
}

describe("performSignIn (Task 5 flow)", () => {
  it("succeeds for a deterministic, allowlisted wallet", async () => {
    const { pubkey, signMessage } = realSigner();
    const out = await performSignIn({
      pubkey,
      signMessage,
      fetchFn: fakeFetch({ status: 200, body: { role: "ambassador", country: "AR" } }),
    });
    expect(out).toEqual({ ok: true, role: "ambassador", country: "AR" });
  });

  it("blocks a non-deterministic wallet before any network call", async () => {
    let n = 0;
    const out = await performSignIn({
      pubkey: "W",
      // returns a different signature each call -> non-deterministic
      signMessage: async () => Uint8Array.from([n++]),
      fetchFn: (() => {
        throw new Error("must not fetch");
      }) as unknown as typeof fetch,
    });
    expect(out).toEqual({ ok: false, reason: "non_deterministic" });
  });

  it("reports not_allowlisted on a 403 from verify", async () => {
    const { pubkey, signMessage } = realSigner();
    const out = await performSignIn({
      pubkey,
      signMessage,
      fetchFn: fakeFetch({ status: 403, body: { error: "wallet_not_authorised" } }),
    });
    expect(out).toEqual({ ok: false, reason: "not_allowlisted" });
  });
});
