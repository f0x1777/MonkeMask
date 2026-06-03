import { NextResponse } from "next/server";

import {
  chapterScope,
  entitledHolders,
  isChapterAmbassador,
  isValidSealedKey,
} from "../../../../../lib/v2/chapter-server";
import { requireRole } from "../../../../../lib/v2/require-role";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

const MAX_CIPHERTEXT = 1_500_000;

// Rotate the chapter CK to cryptographically revoke a removed member. The caller (a
// current holder) generates a new CK, re-seals it to every REMAINING entitled holder,
// and re-encrypts every record under it; this route validates the recipients are still
// entitled and applies it all atomically via the rekey_chapter() function.
export async function POST(req: Request) {
  const s = await requireRole(["ambassador"]);
  if (!s || !s.country) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = supabaseService();
  const scope = chapterScope(s.country);

  // Caller must be a still-active chapter ambassador AND a current holder.
  if (!(await isChapterAmbassador(db, s.country, s.wallet_pubkey))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { data: self } = await db
    .from("scoped_key_grants")
    .select("wallet_pubkey")
    .eq("scope", scope)
    .eq("wallet_pubkey", s.wallet_pubkey)
    .is("superseded_at", null)
    .maybeSingle();
  if (!self) return NextResponse.json({ error: "not_enrolled" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const grantsIn: unknown[] = Array.isArray(body.grants) ? body.grants : [];
  const recordsIn: unknown[] = Array.isArray(body.records) ? body.records : [];

  // Only seal to wallets that are STILL entitled (this is the revocation: the removed
  // member is no longer in the set, so they get no new grant).
  const holders = await entitledHolders(db, s.country);
  const grants = grantsIn
    .filter(
      (g: unknown): g is { wallet_pubkey: string; sealed_key: string } =>
        typeof (g as { wallet_pubkey?: unknown }).wallet_pubkey === "string" &&
        isValidSealedKey((g as { sealed_key?: unknown }).sealed_key),
    )
    .filter((g) => holders.has(g.wallet_pubkey));
  // The caller themselves must be among the new grants, or they'd lock themselves out.
  if (!grants.some((g) => g.wallet_pubkey === s.wallet_pubkey)) {
    return NextResponse.json({ error: "must_include_self" }, { status: 400 });
  }

  const records = recordsIn.filter(
    (r: unknown): r is { person_id: string; ciphertext: string; iv: string } =>
      typeof (r as { person_id?: unknown }).person_id === "string" &&
      typeof (r as { ciphertext?: unknown }).ciphertext === "string" &&
      typeof (r as { iv?: unknown }).iv === "string" &&
      (r as { ciphertext: string }).ciphertext.length <= MAX_CIPHERTEXT,
  );

  const { data: version, error } = await db.rpc("rekey_chapter", {
    p_scope: scope,
    p_country: s.country,
    p_actor: s.wallet_pubkey,
    p_grants: grants,
    p_records: records,
  });
  if (error) return NextResponse.json({ error: "rekey_failed" }, { status: 400 });
  await db.from("audit_log").insert({
    action: "chapter.rekey",
    actor_wallet: s.wallet_pubkey,
    target_country: s.country,
    metadata: { key_version: version, holders: grants.length, records: records.length },
  });
  return NextResponse.json({ ok: true, key_version: version, holders: grants.length });
}
