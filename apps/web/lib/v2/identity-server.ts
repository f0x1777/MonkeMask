// Server-side validation for registered encryption identities (member + global).
import { b64decode } from "./bytes";

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** An X25519 box public key is exactly 32 bytes -> 44 base64 chars. */
export function isValidEncPubKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length > 48 || !B64.test(key)) return false;
  try {
    return b64decode(key).length === 32;
  } catch {
    return false;
  }
}
