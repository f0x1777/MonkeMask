import nacl from "tweetnacl";
import { describe, it, expect } from "vitest";

import { generateBoxKeypair, seal, sealOpen } from "./sealedbox";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe("sealed box (global registry write-without-read)", () => {
  it("an ambassador can seal to the global public key; a global_admin opens it", () => {
    const global = generateBoxKeypair(); // secret stays with global_admins
    const sealed = seal(enc("face->monke entry"), global.publicKey); // ambassador only has the public key
    const opened = sealOpen(sealed, global);
    expect(opened).not.toBeNull();
    expect(dec(opened!)).toBe("face->monke entry");
  });

  it("the wrong secret key cannot open it", () => {
    const global = generateBoxKeypair();
    const intruder = generateBoxKeypair();
    const sealed = seal(enc("secret"), global.publicKey);
    expect(sealOpen(sealed, intruder)).toBeNull();
  });

  it("two seals of the same message differ (ephemeral key per seal)", () => {
    const global = generateBoxKeypair();
    const a = seal(enc("x"), global.publicKey);
    const b = seal(enc("x"), global.publicKey);
    expect(nacl.verify(a, b)).toBe(false);
    // ...but both still open to the same plaintext
    expect(dec(sealOpen(a, global)!)).toBe("x");
    expect(dec(sealOpen(b, global)!)).toBe("x");
  });
});
