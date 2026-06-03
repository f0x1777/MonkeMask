// Global registry crypto: ambassadors SEAL {embedding, monke} to the global box
// public key (write-only); global_admins hold the secret key (wrapped per-wallet under
// their KEK) and OPEN it. Pure functions (no React); the hook in ./useGlobalVault wires
// these to the network. A secret never lands on-chain — the wrap is the custody.

import { b64decode, b64encode } from "./bytes";
import { unwrapKeyExtractable, wrapKey } from "./crypto";
import { generateBoxKeypair, seal, sealOpen, type BoxKeypair } from "./sealedbox";

const subtle = globalThis.crypto.subtle;

export type GlobalEntry = { embedding: number[]; monke: string };

/** Fresh global box keypair (run once, by the global_admin who initialises). */
export function newGlobalKeypair(): BoxKeypair {
  return generateBoxKeypair();
}

/** Seal an entry to the global public key (base64). Returns base64. Anyone can do
 * this; only the secret-key holder can open it. */
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

// The KEK's only privileges are wrapKey/unwrapKey (least privilege). The nacl secret
// is 32 raw bytes, so we import it as a raw AES key and wrap it with the same audited
// envelope primitive the country key uses — no need to broaden the KEK to encrypt/decrypt.

/** Wrap the global secret key under a global_admin's wallet KEK. */
export async function wrapSecret(
  kek: CryptoKey,
  secretKey: Uint8Array,
): Promise<{ wrapped: string; iv: string }> {
  const asKey = await subtle.importKey("raw", secretKey, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
  const { iv, wrapped } = await wrapKey(kek, asKey);
  return { wrapped: b64encode(wrapped), iv: b64encode(iv) };
}

/** Unwrap the global secret key with the wallet KEK. Throws on a wrong KEK. */
export async function unwrapSecret(kek: CryptoKey, wrappedB64: string, ivB64: string): Promise<Uint8Array> {
  const key = await unwrapKeyExtractable(kek, b64decode(wrappedB64), b64decode(ivB64));
  return new Uint8Array(await subtle.exportKey("raw", key));
}
