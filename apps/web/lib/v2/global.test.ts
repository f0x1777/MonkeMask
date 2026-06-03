import { describe, it, expect } from "vitest";

import { b64encode } from "./bytes";
import { deriveBytes } from "./crypto";
import {
  deriveEncKeypair,
  newGlobalKeypair,
  openEntry,
  openSealedSecret,
  sealEntry,
  sealSecretToAdmin,
} from "./global";
import { generateBoxKeypair } from "./sealedbox";

const sig = (n: number) => new Uint8Array(64).fill(n);
const entry = { embedding: [0.1, -0.2, 0.3], monke: "data:image/png;base64,AAAA" };

describe("global registry crypto", () => {
  it("seals to the public key; only the secret-key holder can open it", () => {
    const kp = newGlobalKeypair();
    const sealed = sealEntry(entry, b64encode(kp.publicKey));
    expect(openEntry(sealed, kp)).toEqual(entry);
    expect(openEntry(sealed, generateBoxKeypair())).toBeNull();
  });

  it("derives a stable encryption identity from a signature (deterministic)", async () => {
    const a = await deriveEncKeypair(sig(5));
    const b = await deriveEncKeypair(sig(5));
    const other = await deriveEncKeypair(sig(6));
    expect(b64encode(a.publicKey)).toBe(b64encode(b.publicKey));
    expect(b64encode(a.publicKey)).not.toBe(b64encode(other.publicKey));
  });

  it("the enc-identity seed is domain-separated from other HKDF info (no collision)", async () => {
    // Same signature, different HKDF info -> independent outputs. This guards against a
    // refactor accidentally unifying the enc-identity derivation with the vault KEK.
    const s = sig(9);
    const identitySeed = await deriveBytes(s, "monkemask-v2/global-admin-enc-identity/v1", 32);
    const otherSeed = await deriveBytes(s, "ambassador-vault-key-encryption-key", 32);
    expect(b64encode(identitySeed)).not.toBe(b64encode(otherSeed));
    // and deterministic for the same info
    expect(b64encode(await deriveBytes(s, "x", 32))).toBe(b64encode(await deriveBytes(s, "x", 32)));
  });

  it("seals the global secret to an admin's identity; only that admin can open it", async () => {
    const global = newGlobalKeypair();
    const admin = await deriveEncKeypair(sig(7));
    const grant = sealSecretToAdmin(global.secretKey, b64encode(admin.publicKey));

    // The admin re-derives their identity and opens the grant -> the global secret.
    const reAdmin = await deriveEncKeypair(sig(7));
    const secret = openSealedSecret(grant, reAdmin);
    expect(secret).not.toBeNull();
    expect(Array.from(secret!)).toEqual(Array.from(global.secretKey));

    // A different admin identity cannot open this grant.
    const intruder = await deriveEncKeypair(sig(8));
    expect(openSealedSecret(grant, intruder)).toBeNull();
  });

  it("full path: grant a new admin by sealing to their pubkey, then read entries", async () => {
    const global = newGlobalKeypair();
    const pubB64 = b64encode(global.publicKey);
    // ambassador contributes
    const sealed = sealEntry(entry, pubB64);

    // a newcomer registers their identity pubkey; an existing admin seals the secret to it
    const newcomer = await deriveEncKeypair(sig(3));
    const grant = sealSecretToAdmin(global.secretKey, b64encode(newcomer.publicKey));

    // the newcomer opens the grant and reads the registry
    const secret = openSealedSecret(grant, await deriveEncKeypair(sig(3)))!;
    const recovered = (await import("./sealedbox")).keypairFromSecret(secret);
    expect(openEntry(sealed, recovered)).toEqual(entry);
  });
});
