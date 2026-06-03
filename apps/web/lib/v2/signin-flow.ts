// The client sign-in flow, extracted from the React component so it is unit-testable
// with a fake signMessage + fetch (no wallet-adapter / DOM needed).

import bs58 from "bs58";

import { KEK_DERIVATION_MESSAGE, buildSiwsMessage } from "./siws";

export type SignInOutcome =
  | { ok: true; role: string; country: string | null }
  | { ok: false; reason: "non_deterministic" | "not_allowlisted" | "error" };

export async function performSignIn(opts: {
  pubkey: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  fetchFn?: typeof fetch;
}): Promise<SignInOutcome> {
  const f = opts.fetchFn ?? fetch;
  const enc = new TextEncoder();

  // 1) Determinism gate: a wallet must sign the same message identically, or its
  //    derived vault key would be unstable. Block non-deterministic wallets.
  const a = await opts.signMessage(enc.encode(KEK_DERIVATION_MESSAGE));
  const b = await opts.signMessage(enc.encode(KEK_DERIVATION_MESSAGE));
  if (bs58.encode(a) !== bs58.encode(b)) return { ok: false, reason: "non_deterministic" };

  try {
    // 2) Fetch a nonce, sign the SIWS message, post it for verification.
    const { nonce } = await f("/api/v2/auth/nonce").then((r) => r.json());
    const sig = await opts.signMessage(enc.encode(buildSiwsMessage(opts.pubkey, nonce)));
    const res = await f("/api/v2/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: opts.pubkey, signature: bs58.encode(sig), nonce }),
    });
    if (res.ok) {
      const j = await res.json();
      return { ok: true, role: j.role, country: j.country ?? null };
    }
    if (res.status === 403) return { ok: false, reason: "not_allowlisted" };
    return { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}
