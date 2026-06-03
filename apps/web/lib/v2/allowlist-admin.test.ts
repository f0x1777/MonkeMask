import { describe, it, expect } from "vitest";

import { validateNewEntry } from "./allowlist-admin";

const WALLET = "4XqXMVeaEx2eactdvVfyu41Ngi6Z2ynRwZJJdQn6ZjGD";

describe("validateNewEntry (super_admin onboarding)", () => {
  it("accepts a global_admin (no country needed, country forced null)", () => {
    expect(validateNewEntry({ wallet_pubkey: WALLET, role: "global_admin" })).toEqual({
      ok: true,
      value: { wallet_pubkey: WALLET, role: "global_admin", country: null },
    });
  });

  it("accepts an ambassador with a country (uppercased)", () => {
    expect(validateNewEntry({ wallet_pubkey: WALLET, role: "ambassador", country: "ar" })).toEqual({
      ok: true,
      value: { wallet_pubkey: WALLET, role: "ambassador", country: "AR" },
    });
  });

  it("rejects an ambassador without a country", () => {
    expect(validateNewEntry({ wallet_pubkey: WALLET, role: "ambassador" })).toEqual({
      ok: false,
      error: "country_required",
    });
  });

  it("rejects an ambassador with a country that isn't a known chapter", () => {
    expect(validateNewEntry({ wallet_pubkey: WALLET, role: "ambassador", country: "ZZ" })).toEqual({
      ok: false,
      error: "invalid_chapter",
    });
  });

  it("accepts a multi-city chapter code", () => {
    expect(validateNewEntry({ wallet_pubkey: WALLET, role: "ambassador", country: "us-ny" })).toEqual({
      ok: true,
      value: { wallet_pubkey: WALLET, role: "ambassador", country: "US-NY" },
    });
  });

  it("accepts a country_ambassador with a valid country", () => {
    expect(validateNewEntry({ wallet_pubkey: WALLET, role: "country_ambassador", country: "us" })).toEqual({
      ok: true,
      value: { wallet_pubkey: WALLET, role: "country_ambassador", country: "US" },
    });
  });

  it("rejects a country_ambassador whose country has no chapters", () => {
    expect(validateNewEntry({ wallet_pubkey: WALLET, role: "country_ambassador", country: "ZZ" })).toEqual({
      ok: false,
      error: "invalid_country",
    });
  });

  it("rejects a country_ambassador pointed at a city-chapter code, not a country", () => {
    expect(validateNewEntry({ wallet_pubkey: WALLET, role: "country_ambassador", country: "US-NY" })).toEqual({
      ok: false,
      error: "invalid_country",
    });
  });

  it("rejects creating another super_admin via the API", () => {
    expect(validateNewEntry({ wallet_pubkey: WALLET, role: "super_admin" })).toEqual({
      ok: false,
      error: "invalid_role",
    });
  });

  it("rejects a malformed wallet", () => {
    expect(validateNewEntry({ wallet_pubkey: "not-a-wallet", role: "global_admin" })).toEqual({
      ok: false,
      error: "invalid_wallet",
    });
  });
});
