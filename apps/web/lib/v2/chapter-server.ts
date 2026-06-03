// Server-side helpers shared by the chapter key / grants / rekey routes.
import type { SupabaseClient } from "@supabase/supabase-js";

import { b64decode } from "./bytes";

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

// Wallets entitled to hold this chapter's CK: the chapter's active ambassadors PLUS
// active global_admins (the recovery / break-glass tier).
export async function entitledHolders(db: SupabaseClient, country: string): Promise<Set<string>> {
  const [{ data: amb }, { data: admins }] = await Promise.all([
    db.from("allowlist").select("wallet_pubkey").eq("role", "ambassador").eq("country", country).is("removed_at", null),
    db.from("allowlist").select("wallet_pubkey").eq("role", "global_admin").is("removed_at", null),
  ]);
  return new Set([...(amb ?? []), ...(admins ?? [])].map((a) => a.wallet_pubkey));
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
