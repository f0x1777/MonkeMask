import bs58 from "bs58";
import nacl from "tweetnacl";
import { describe, it, expect } from "vitest";

import { authenticateWallet, type AuthStore, type AllowRow, type NonceRow } from "./auth-verify";
import { buildSiwsMessage } from "./siws";

// A fake AuthStore backed by plain objects, recording side effects.
function makeStore(opts: {
  nonce?: NonceRow | null;
  allow?: AllowRow | null;
}): AuthStore & { consumed: string[]; audits: string[] } {
  const consumed: string[] = [];
  const audits: string[] = [];
  return {
    consumed,
    audits,
    async getNonce() {
      return opts.nonce ?? null;
    },
    async consumeNonce(n) {
      consumed.push(n);
    },
    async getAllowlistEntry() {
      return opts.allow ?? null;
    },
    async audit(action) {
      audits.push(action);
    },
  };
}

const future = new Date(Date.now() + 60_000).toISOString();

function signed(nonce: string) {
  const kp = nacl.sign.keyPair();
  const pubkey = bs58.encode(kp.publicKey);
  const message = buildSiwsMessage(pubkey, nonce);
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
  return { pubkey, signature };
}

describe("authenticateWallet (Task 4)", () => {
  it("authorises an allowlisted wallet with a valid signature + fresh nonce", async () => {
    const { pubkey, signature } = signed("n1");
    const store = makeStore({
      nonce: { nonce: "n1", expires_at: future, consumed_at: null },
      allow: { role: "ambassador", country: "AR" },
    });
    const res = await authenticateWallet({ pubkey, signature, nonce: "n1" }, store);
    expect(res).toEqual({ ok: true, wallet_pubkey: pubkey, role: "ambassador", country: "AR" });
    expect(store.consumed).toEqual(["n1"]);
    expect(store.audits).toEqual(["auth.signin"]);
  });

  it("rejects a non-allowlisted wallet with 403 and audits the denial", async () => {
    const { pubkey, signature } = signed("n2");
    const store = makeStore({
      nonce: { nonce: "n2", expires_at: future, consumed_at: null },
      allow: null,
    });
    const res = await authenticateWallet({ pubkey, signature, nonce: "n2" }, store);
    expect(res).toEqual({ ok: false, status: 403, error: "wallet_not_authorised" });
    expect(store.audits).toEqual(["auth.denied"]);
  });

  it("rejects an invalid signature with 401", async () => {
    const { pubkey } = signed("n3");
    const other = signed("n3"); // a different keypair's signature
    const store = makeStore({
      nonce: { nonce: "n3", expires_at: future, consumed_at: null },
      allow: { role: "ambassador", country: "AR" },
    });
    const res = await authenticateWallet({ pubkey, signature: other.signature, nonce: "n3" }, store);
    expect(res).toEqual({ ok: false, status: 401, error: "signature_invalid" });
  });

  it("rejects an expired nonce", async () => {
    const { pubkey, signature } = signed("n4");
    const store = makeStore({
      nonce: { nonce: "n4", expires_at: new Date(Date.now() - 1000).toISOString(), consumed_at: null },
      allow: { role: "ambassador", country: "AR" },
    });
    const res = await authenticateWallet({ pubkey, signature, nonce: "n4" }, store);
    expect(res).toEqual({ ok: false, status: 400, error: "nonce_expired" });
  });

  it("rejects an already-consumed nonce", async () => {
    const { pubkey, signature } = signed("n5");
    const store = makeStore({
      nonce: { nonce: "n5", expires_at: future, consumed_at: new Date().toISOString() },
      allow: { role: "ambassador", country: "AR" },
    });
    const res = await authenticateWallet({ pubkey, signature, nonce: "n5" }, store);
    expect(res).toEqual({ ok: false, status: 400, error: "nonce_consumed" });
  });

  it("rejects missing fields with 400", async () => {
    const store = makeStore({});
    expect(await authenticateWallet({}, store)).toEqual({
      ok: false,
      status: 400,
      error: "missing_fields",
    });
  });
});
