// Server-side helpers shared by the chapter key / grants / rekey routes.
import type { SupabaseClient } from "@supabase/supabase-js";

import { b64decode } from "./bytes";
import { countryOf } from "./chapters";

export function chapterScope(country: string): string {
  return `chapter:${country}`;
}

// A nacl sealed box of a 32-byte CK is 32+32+16 = 80 bytes -> 108 base64 chars.
export function isValidSealedKey(s: unknown): s is string {
  if (typeof s !== "string" || s.length > 120) return false;
  try {
    return b64decode(s).length === 80;
  } catch {
    return false;
  }
}

// Wallets entitled to hold this chapter's CK: the chapter's own active ambassadors, the
// country ambassador(s) of the chapter's country (who read every chapter in their
// country), PLUS active global_admins (the recovery / break-glass tier). Each tier can
// already read these associations at its level, so holding the CK adds no exposure.
export async function entitledHolders(db: SupabaseClient, chapterCode: string): Promise<Set<string>> {
  const country = countryOf(chapterCode);
  const [{ data: amb }, { data: countryAmb }, { data: admins }] = await Promise.all([
    db.from("allowlist").select("wallet_pubkey").eq("role", "ambassador").eq("country", chapterCode).is("removed_at", null),
    db.from("allowlist").select("wallet_pubkey").eq("role", "country_ambassador").eq("country", country).is("removed_at", null),
    db.from("allowlist").select("wallet_pubkey").eq("role", "global_admin").is("removed_at", null),
  ]);
  return new Set([...(amb ?? []), ...(countryAmb ?? []), ...(admins ?? [])].map((a) => a.wallet_pubkey));
}

// Whether a wallet is an active ambassador OF THIS chapter (only these may issue grants).
export async function isChapterAmbassador(db: SupabaseClient, country: string, wallet: string): Promise<boolean> {
  const { data } = await db
    .from("allowlist")
    .select("wallet_pubkey")
    .eq("role", "ambassador")
    .eq("country", country)
    .eq("wallet_pubkey", wallet)
    .is("removed_at", null)
    .maybeSingle();
  return !!data;
}
