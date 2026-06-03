// Global registry crypto.
//
// Two layers of anonymous public-key encryption (nacl.box sealed boxes):
//   1. Ambassadors SEAL {embedding, monke} to the GLOBAL box public key (write-only).
//   2. The global box SECRET key is itself SEALED to each global_admin's "encryption
//      identity" public key — a stable X25519 keypair the admin derives from a wallet
//      signature. So distributing read access to a new admin is just "seal the secret
//      to their registered pubkey": no handshake, and the super_admin never holds it.
//
// Pure functions (no React); the hook in ./useGlobalVault wires them to the network.

import { b64decode, b64encode } from "./bytes";
import { deriveBytes } from "./crypto";
import { generateBoxKeypair, keypairFromSecret, seal, sealOpen, type BoxKeypair } from "./sealedbox";

export type GlobalEntry = { embedding: number[]; monke: string };

// HKDF domain for the admin encryption identity (kept distinct from the country KEK).
const ENC_IDENTITY_INFO = "monkemask-v2/global-admin-enc-identity/v1";

/** Fresh global box keypair (generated once, by the global_admin who initialises). */
export function newGlobalKeypair(): BoxKeypair {
  return generateBoxKeypair();
}

/** Derive a global_admin's stable X25519 "encryption identity" from a wallet signature.
 * Deterministic: re-signing yields the same keypair, so the admin can always re-open
 * grants sealed to their published public key. */
export async function deriveEncKeypair(signature: Uint8Array): Promise<BoxKeypair> {
  const seed = await deriveBytes(signature, ENC_IDENTITY_INFO, 32);
  return keypairFromSecret(seed);
}

/** Seal an entry to the global public key (base64). Returns base64. Anyone can do this;
 * only the secret-key holder can open it. */
export function sealEntry(entry: GlobalEntry, boxPublicKeyB64: string): string {
  const msg = new TextEncoder().encode(JSON.stringify(entry));
  return b64encode(seal(msg, b64decode(boxPublicKeyB64)));
}

/** Open a sealed entry with the global keypair. Returns null if it can't be opened
 * (wrong key) or doesn't parse. */
export function openEntry(sealedB64: string, keypair: BoxKeypair): GlobalEntry | null {
  const out = sealOpen(b64decode(sealedB64), keypair);
  if (!out) return null;
  try {
    return JSON.parse(new TextDecoder().decode(out)) as GlobalEntry;
  } catch {
    return null;
  }
}

/** Seal the global box SECRET key to a global_admin's encryption public key (base64),
 * producing that admin's grant. Only they (re-deriving their identity) can open it. */
export function sealSecretToAdmin(globalSecretKey: Uint8Array, adminEncPublicKeyB64: string): string {
  return b64encode(seal(globalSecretKey, b64decode(adminEncPublicKeyB64)));
}

/** Open a sealed grant with the admin's encryption keypair → the global box secret key.
 * Returns null if the grant wasn't sealed to this identity. */
export function openSealedSecret(sealedSecretB64: string, encKeypair: BoxKeypair): Uint8Array | null {
  return sealOpen(b64decode(sealedSecretB64), encKeypair);
}
