// Envelope-encryption primitives for the member-vault platform (Phase 1, Task 6).
//
// Model: a wallet signature over a fixed message deterministically derives a
// wrapping key (KEK). The KEK wraps a random data key (a per-country key CK or the
// global key GK). Data is encrypted with the data key. The server only ever stores
// ciphertext + wrapped keys — never a plaintext key and never the signature.
//
// Pure WebCrypto, so the identical module runs in the browser and in Node 22+
// (globalThis.crypto.subtle exists in both).

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

// Fixed HKDF context: the same signature must always derive the same KEK, so salt
// and info are constants (not random). Versioned so we can rotate the scheme later.
const KEK_SALT = enc.encode("monkemask-v2/kek/v1");
const KEK_INFO = enc.encode("ambassador-vault-key-encryption-key");

const IV_BYTES = 12; // AES-GCM standard nonce length

/**
 * Derive a non-extractable wrapping key (KEK) from a wallet signature via
 * HKDF-SHA256. Deterministic: an identical signature yields an identical KEK, which
 * is what lets an ambassador re-derive their KEK every session by re-signing.
 */
export async function deriveKEK(signature: Uint8Array): Promise<CryptoKey> {
  const base = await subtle.importKey("raw", signature, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: KEK_SALT, info: KEK_INFO },
    base,
    { name: "AES-GCM", length: 256 },
    false, // KEK never leaves WebCrypto
    ["wrapKey", "unwrapKey"],
  );
}

/** Deterministically derive raw bytes from a wallet signature via HKDF-SHA256. Used to
 * seed a stable X25519 box keypair (the global_admin's "encryption identity"): the same
 * signature always yields the same bytes, so the admin re-derives it by re-signing. The
 * `info` separates this domain from the KEK so the two derivations never collide. */
export async function deriveBytes(signature: Uint8Array, info: string, length = 32): Promise<Uint8Array> {
  const base = await subtle.importKey("raw", signature, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: KEK_SALT, info: enc.encode(info) },
    base,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** A fresh random AES-256-GCM data key (a per-country CK or the global GK).
 * Extractable so it can be wrapped by a KEK. */
export async function generateDataKey(): Promise<CryptoKey> {
  return subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

/** Wrap (encrypt) a data key under a KEK. Returns the iv + wrapped bytes to store. */
export async function wrapKey(
  kek: CryptoKey,
  dataKey: CryptoKey,
): Promise<{ iv: Uint8Array; wrapped: Uint8Array }> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const wrapped = new Uint8Array(await subtle.wrapKey("raw", dataKey, kek, { name: "AES-GCM", iv }));
  return { iv, wrapped };
}

/** Unwrap a data key under a KEK. Throws if the KEK is wrong (GCM auth tag fails) —
 * this is exactly how a non-deterministic or foreign signature is rejected.
 *
 * The unwrapped key is NON-extractable: it can encrypt/decrypt but its raw bytes can
 * never be exported (so XSS holding the in-memory CryptoKey still can't exfiltrate the
 * country key). The global registry secret never uses this path — it's raw nacl bytes
 * distributed via sealed boxes, not a wrapped WebCrypto key. */
export async function unwrapKey(
  kek: CryptoKey,
  wrapped: Uint8Array,
  iv: Uint8Array,
): Promise<CryptoKey> {
  return unwrapKeyInternal(kek, wrapped, iv, false);
}

function unwrapKeyInternal(
  kek: CryptoKey,
  wrapped: Uint8Array,
  iv: Uint8Array,
  extractable: boolean,
): Promise<CryptoKey> {
  return subtle.unwrapKey(
    "raw",
    wrapped,
    kek,
    { name: "AES-GCM", iv },
    { name: "AES-GCM", length: 256 },
    extractable,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt plaintext with a data key. Returns iv + ciphertext (GCM tag appended). */
export async function encrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  return { iv, ciphertext };
}

/** Decrypt ciphertext with a data key. Throws on wrong key, iv, or tampering. */
export async function decrypt(
  key: CryptoKey,
  ciphertext: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext));
}
