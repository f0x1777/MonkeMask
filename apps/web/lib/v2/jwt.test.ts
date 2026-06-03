import { describe, it, expect, beforeAll } from "vitest";

import { getSession, mintSession } from "./jwt";

beforeAll(() => {
  process.env.V2_JWT_SECRET = "test-secret-please-ignore-0123456789abcdef";
});

describe("v2 session JWT", () => {
  it("mints a token that verifies back to the same claims", async () => {
    const token = await mintSession({ wallet_pubkey: "WALLET", role: "ambassador", country: "AR" });
    const s = await getSession(token);
    expect(s).toEqual({ wallet_pubkey: "WALLET", role: "ambassador", country: "AR" });
  });

  it("returns null for a missing token", async () => {
    expect(await getSession(undefined)).toBeNull();
  });

  it("returns null for a tampered token", async () => {
    const token = await mintSession({ wallet_pubkey: "W", role: "super_admin", country: null });
    expect(await getSession(token.slice(0, -3) + "xyz")).toBeNull();
  });

  it("returns null for a token signed with a different secret", async () => {
    const token = await mintSession({ wallet_pubkey: "W", role: "ambassador", country: "BR" });
    process.env.V2_JWT_SECRET = "a-totally-different-secret-value-aaaaaaaaaa";
    const result = await getSession(token);
    process.env.V2_JWT_SECRET = "test-secret-please-ignore-0123456789abcdef";
    expect(result).toBeNull();
  });
});
