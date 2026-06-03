import { NextResponse } from "next/server";

import {
  chapterScope as scopeFor,
  entitledHolders,
  isChapterAmbassador,
  isValidSealedKey,
} from "../../../../../lib/v2/chapter-server";
import { requireRole } from "../../../../../lib/v2/require-role";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// Enrollment for a chapter. An already-enrolled, still-active chapter ambassador seals
// the CK to each pending ambassador of the same chapter. Mirrors the global enrollment
// hardening: active-allowlist self-check + insert-only (no clobbering a peer's grant).

export async function GET() {
  const s = await requireRole(["ambassador"]);
  if (!s || !s.country) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = supabaseService();
  const scope = scopeFor(s.country);
  // Only a chapter ambassador (a CK holder) issues grants; recipients are the broader
  // entitled set (chapter ambassadors + global_admin recovery holders).
  if (!(await isChapterAmbassador(db, s.country, s.wallet_pubkey))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const holders = await entitledHolders(db, s.country);

  // Scope the identity pull to entitled holders server-side (don't pull the whole table).
  const [{ data: ids }, { data: grants }] = await Promise.all([
    db
      .from("member_identities")
      .select("wallet_pubkey,enc_public_key,identity_sig")
      .in("wallet_pubkey", [...holders])
      .not("identity_sig", "is", null),
    db.from("scoped_key_grants").select("wallet_pubkey").eq("scope", scope).is("superseded_at", null),
  ]);
  const granted = new Set((grants ?? []).map((g) => g.wallet_pubkey));
  const pending = (ids ?? []).filter((i) => !granted.has(i.wallet_pubkey));
  // `holders` = every entitled holder with a registered identity (granted or not); the
  // re-key flow seals the new CK to all of them. Never cache — the holder set drives
  // revocation, so a stale list could re-seal the CK to a just-removed member.
  return NextResponse.json({ pending, holders: ids ?? [] }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const s = await requireRole(["ambassador"]);
  if (!s || !s.country) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = supabaseService();
  const scope = scopeFor(s.country);

  // Caller must be a still-active ambassador of this chapter AND already enrolled.
  if (!(await isChapterAmbassador(db, s.country, s.wallet_pubkey))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const holders = await entitledHolders(db, s.country);
  const { data: self } = await db
    .from("scoped_key_grants")
    .select("wallet_pubkey")
    .eq("scope", scope)
    .eq("wallet_pubkey", s.wallet_pubkey)
    .is("superseded_at", null)
    .maybeSingle();
  if (!self) return NextResponse.json({ error: "not_enrolled" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const grants: unknown[] = Array.isArray(body.grants) ? body.grants : [];
  if (grants.length === 0) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const candidates = grants
    .filter(
      (g: unknown): g is { wallet_pubkey: string; sealed_key: string } =>
        typeof (g as { wallet_pubkey?: unknown }).wallet_pubkey === "string" &&
        isValidSealedKey((g as { sealed_key?: unknown }).sealed_key),
    )
    .filter((g) => holders.has(g.wallet_pubkey));

  // Insert-only: never overwrite an existing active grant (no peer lockout).
  const { data: existing } = await db
    .from("scoped_key_grants")
    .select("wallet_pubkey")
    .eq("scope", scope)
    .is("superseded_at", null)
    .in("wallet_pubkey", candidates.map((g) => g.wallet_pubkey));
  const alreadyGranted = new Set((existing ?? []).map((g) => g.wallet_pubkey));

  const rows = candidates
    .filter((g) => !alreadyGranted.has(g.wallet_pubkey))
    .map((g) => ({
      wallet_pubkey: g.wallet_pubkey,
      scope,
      sealed_key: g.sealed_key,
      granted_by: s.wallet_pubkey,
    }));
  if (rows.length === 0) return NextResponse.json({ error: "no_valid_grants" }, { status: 400 });

  const { error } = await db.from("scoped_key_grants").insert(rows);
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 400 });
  await db.from("audit_log").insert({
    action: "chapter.grant",
    actor_wallet: s.wallet_pubkey,
    target_country: s.country,
    metadata: { granted: rows.map((r) => r.wallet_pubkey) },
  });
  return NextResponse.json({ ok: true, granted: rows.length });
}
