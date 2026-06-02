// SIWS verify flow logic (Task 4), decoupled from Supabase + HTTP so it is fully
// unit-testable. The route handler implements AuthStore over the service client.

import { buildSiwsMessage, verifySiws } from "./siws";

export type NonceRow = { nonce: string; expires_at: string; consumed_at: string | null };
export type AllowRow = { role: string; country: string | null };

export interface AuthStore {
  getNonce(nonce: string): Promise<NonceRow | null>;
  consumeNonce(nonce: string): Promise<void>;
  getAllowlistEntry(pubkey: string): Promise<AllowRow | null>;
  audit(action: string, actorWallet: string): Promise<void>;
}

export type AuthResult =
  | { ok: true; wallet_pubkey: string; role: string; country: string | null }
  | { ok: false; status: number; error: string };

/**
 * Validate a SIWS sign-in: nonce freshness + single use, ed25519 signature over the
 * reconstructed message, then the allowlist gate. Side effects (consume nonce, audit)
 * go through the injected store.
 */
export async function authenticateWallet(
  body: { pubkey?: unknown; signature?: unknown; nonce?: unknown },
  store: AuthStore,
  now: Date = new Date(),
): Promise<AuthResult> {
  const pubkey = typeof body.pubkey === "string" ? body.pubkey : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  const nonce = typeof body.nonce === "string" ? body.nonce : "";
  if (!pubkey || !signature || !nonce) return { ok: false, status: 400, error: "missing_fields" };

  const row = await store.getNonce(nonce);
  if (!row) return { ok: false, status: 400, error: "nonce_invalid" };
  if (row.consumed_at) return { ok: false, status: 400, error: "nonce_consumed" };
  if (new Date(row.expires_at).getTime() < now.getTime()) {
    return { ok: false, status: 400, error: "nonce_expired" };
  }

  if (!verifySiws(buildSiwsMessage(pubkey, nonce), signature, pubkey)) {
    return { ok: false, status: 401, error: "signature_invalid" };
  }
  await store.consumeNonce(nonce);

  const entry = await store.getAllowlistEntry(pubkey);
  if (!entry) {
    await store.audit("auth.denied", pubkey);
    return { ok: false, status: 403, error: "wallet_not_authorised" };
  }
  await store.audit("auth.signin", pubkey);
  return { ok: true, wallet_pubkey: pubkey, role: entry.role, country: entry.country };
}
