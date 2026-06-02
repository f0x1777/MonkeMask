// Anonymous public-key encryption (libsodium-style "sealed box", reimplemented on
// tweetnacl). ANYONE can seal a message to a recipient's public key; ONLY the holder
// of the matching secret key can open it, and the sender is anonymous.
//
// This is the global registry's encryption: Local Ambassadors SEAL roster entries to
// the global PUBLIC key (they can contribute/upload) but cannot read the registry;
// global_admins hold the secret key (wrapped to their wallets) and are the only ones
// who can OPEN + match it. Not wire-compatible with libsodium (own nonce derivation),
// which is fine — both ends are our code.

import nacl from "tweetnacl";

export type BoxKeypair = { publicKey: Uint8Array; secretKey: Uint8Array };

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const c = new Uint8Array(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return c;
}

// Deterministic nonce from the ephemeral + recipient public keys (so the recipient
// can recompute it without it being transmitted).
function deriveNonce(ephPk: Uint8Array, recipPk: Uint8Array): Uint8Array {
  return nacl.hash(concat(ephPk, recipPk)).slice(0, nacl.box.nonceLength);
}

/** The global registry keypair. The public key is public; the secret key is wrapped
 * to each global_admin's wallet KEK. */
export function generateBoxKeypair(): BoxKeypair {
  return nacl.box.keyPair();
}

/** Seal a message to a recipient public key. No sender key needed — anonymous. */
export function seal(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  const eph = nacl.box.keyPair();
  const nonce = deriveNonce(eph.publicKey, recipientPublicKey);
  const ct = nacl.box(message, nonce, recipientPublicKey, eph.secretKey);
  return concat(eph.publicKey, ct); // ephemeral public key is prepended
}

/** Open a sealed message with the recipient keypair. Returns null if not for us. */
export function sealOpen(sealed: Uint8Array, recipient: BoxKeypair): Uint8Array | null {
  if (sealed.length < nacl.box.publicKeyLength) return null;
  const ephPk = sealed.slice(0, nacl.box.publicKeyLength);
  const ct = sealed.slice(nacl.box.publicKeyLength);
  const nonce = deriveNonce(ephPk, recipient.publicKey);
  return nacl.box.open(ct, nonce, ephPk, recipient.secretKey);
}
