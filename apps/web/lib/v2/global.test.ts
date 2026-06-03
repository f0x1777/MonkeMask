import { describe, it, expect } from "vitest";

import { b64encode } from "./bytes";
import { deriveKEK } from "./crypto";
import { newGlobalKeypair, openEntry, sealEntry, unwrapSecret, wrapSecret } from "./global";
import { generateBoxKeypair, keypairFromSecret } from "./sealedbox";

const sig = (n: number) => new Uint8Array(64).fill(n);
const entry = { embedding: [0.1, -0.2, 0.3], monke: "data:image/png;base64,AAAA" };

describe("global registry crypto", () => {
  it("seals to the public key; only the secret-key holder can open it", () => {
    const kp = newGlobalKeypair();
    const sealed = sealEntry(entry, b64encode(kp.publicKey));
    expect(openEntry(sealed, kp)).toEqual(entry);
    // a different keypair cannot open it (write-only for everyone else)
    expect(openEntry(sealed, generateBoxKeypair())).toBeNull();
  });

  it("wraps the secret key under a wallet KEK and unwraps it back; wrong KEK fails", async () => {
    const kp = newGlobalKeypair();
    const kek = await deriveKEK(sig(7));
    const { wrapped, iv } = await wrapSecret(kek, kp.secretKey);
    const back = await unwrapSecret(kek, wrapped, iv);
    expect(Array.from(back)).toEqual(Array.from(kp.secretKey));
    const wrongKek = await deriveKEK(sig(8));
    await expect(unwrapSecret(wrongKek, wrapped, iv)).rejects.toThrow();
  });

  it("full path: wrap secret -> unwrap -> rebuild keypair -> open a sealed entry", async () => {
    const kp = newGlobalKeypair();
    const pubB64 = b64encode(kp.publicKey);
    const kek = await deriveKEK(sig(3));
    const { wrapped, iv } = await wrapSecret(kek, kp.secretKey);

    // Later, the global_admin signs in, unwraps, and reads the registry:
    const secret = await unwrapSecret(kek, wrapped, iv);
    const reKp = keypairFromSecret(secret);
    expect(openEntry(sealEntry(entry, pubB64), reKp)).toEqual(entry);
  });
});
