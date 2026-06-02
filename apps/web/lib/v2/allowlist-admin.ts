// Validation for super_admin onboarding of new allowlist entries. Pure + tested.
// super_admin can add global_admin and ambassador roles (not another super_admin via
// the API — that stays a manual seed for safety).

export type NewEntry = {
  wallet_pubkey: string;
  role: "global_admin" | "ambassador";
  country: string | null;
};

const SOLANA_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function validateNewEntry(input: {
  wallet_pubkey?: unknown;
  role?: unknown;
  country?: unknown;
}): { ok: true; value: NewEntry } | { ok: false; error: string } {
  const wallet = typeof input.wallet_pubkey === "string" ? input.wallet_pubkey.trim() : "";
  const role = input.role;
  const country = typeof input.country === "string" ? input.country.trim().toUpperCase() : "";

  if (!SOLANA_PUBKEY.test(wallet)) return { ok: false, error: "invalid_wallet" };
  if (role !== "global_admin" && role !== "ambassador") return { ok: false, error: "invalid_role" };
  if (role === "ambassador" && !country) return { ok: false, error: "country_required" };

  return {
    ok: true,
    value: { wallet_pubkey: wallet, role, country: role === "ambassador" ? country : null },
  };
}
