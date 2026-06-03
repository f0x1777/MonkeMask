import { describe, it, expect } from "vitest";

import { b64decode, b64encode } from "./bytes";

describe("base64 bytes", () => {
  it("round-trips arbitrary bytes", () => {
    const u = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    expect(Array.from(b64decode(b64encode(u)))).toEqual(Array.from(u));
  });

  it("round-trips a 32-byte key", () => {
    const u = crypto.getRandomValues(new Uint8Array(32));
    expect(Array.from(b64decode(b64encode(u)))).toEqual(Array.from(u));
  });
});
