// Sign-In With Solana (SIWS) core for the /v2 auth flow (Phase 1, Task 4).
// Pure + unit-tested. The client builds the message, the wallet signs it, and the
// /api/v2/auth/verify route uses verifySiws() before checking the allowlist.

import bs58 from "bs58";
import nacl from "tweetnacl";

const enc = new TextEncoder();

// The fixed message the wallet signs to derive the vault KEK (see lib/v2/crypto.ts).
// Kept here so client + server agree on the exact bytes.
export const KEK_DERIVATION_MESSAGE =
  "MonkeMask v2 — derive my vault key. Only sign this in the official app.";

// The fixed message a global_admin signs to derive their stable X25519 "encryption
// identity" (see lib/v2/global.ts). The global registry secret is sealed to that
// identity's public key. Distinct from the country-vault message so the derivations
// are independent.
export const GLOBAL_ENC_IDENTITY_MESSAGE =
  "MonkeMask v2 — derive my GLOBAL registry identity. Only sign this in the official app.";

// The message a chapter/country ambassador signs to derive their encryption identity
// (the chapter CK is sealed to it). Per-wallet, reused across the scopes they hold.
export const MEMBER_ENC_IDENTITY_MESSAGE =
  "MonkeMask v2 — derive my member identity. Only sign this in the official app.";

// Binds a derived encryption-identity public key to the wallet: the wallet signs this
// message, so a compromised server can't substitute a different pubkey at enroll time
// (the granter verifies the wallet actually signed the pubkey before sealing to it).
export function identityBindingMessage(encPublicKeyB64: string): string {
  return `MonkeMask v2 — I bind this encryption identity to my wallet:\n${encPublicKeyB64}`;
}

/** Verify a wallet signed the binding for ``encPublicKeyB64``. Never throws. */
export function verifyIdentityBinding(
  encPublicKeyB64: string,
  signatureBase58: string,
  walletPubkey: string,
): boolean {
  return verifySiws(identityBindingMessage(encPublicKeyB64), signatureBase58, walletPubkey);
}

/** Build the canonical SIWS sign-in message. Deterministic given (pubkey, nonce) so
 * the server reconstructs the exact same string it asks the client to sign. */
export function buildSiwsMessage(pubkey: string, nonce: string): string {
  return [
    "MonkeMask v2 wants you to sign in with your Solana account:",
    pubkey,
    "",
    "Authorize access to the Local Ambassadors platform. This signature proves " +
      "wallet ownership and authorizes no transaction.",
    "",
    `Nonce: ${nonce}`,
  ].join("\n");
}

/** Verify an ed25519 signature over a SIWS message. ``signatureBase58`` and
 * ``pubkey`` are base58 (the wallet-adapter / Solana-address encoding). Never
 * throws — malformed input returns false. */
export function verifySiws(message: string, signatureBase58: string, pubkey: string): boolean {
  try {
    const sig = bs58.decode(signatureBase58);
    const pk = bs58.decode(pubkey);
    if (sig.length !== 64 || pk.length !== 32) return false;
    return nacl.sign.detached.verify(enc.encode(message), sig, pk);
  } catch {
    return false;
  }
}
