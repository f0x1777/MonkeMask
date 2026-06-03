import { NextResponse } from "next/server";

import { requireRole } from "../../../../../lib/v2/require-role";
import { supabaseService } from "../../../../../lib/v2/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// Enrollment. An already-enrolled, still-active global_admin (one who holds the secret)
// seals it to each pending admin's registered encryption pubkey and posts the grants.
// No handshake: the pending admin just needs to have registered their identity.

// Is this wallet currently a global_admin (not removed)? A grant row alone isn't enough
// — a removed admin keeps their old grant but must not be able to act.
async function isActiveGlobalAdmin(db: SupabaseClient, wallet: string): Promise<boolean> {
  const { data } = await db
    .from("allowlist")
    .select("wallet_pubkey")
    .eq("wallet_pubkey", wallet)
    .eq("role", "global_admin")
    .is("removed_at", null)
    .maybeSingle();
  return !!data;
}

// Pending = a registered admin identity that has no grant yet. Returns the wallet +
// pubkey so the caller can seal the secret to each.
export async function GET() {
  const s = await requireRole(["global_admin"]);
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = supabaseService();
  if (!(await isActiveGlobalAdmin(db, s.wallet_pubkey))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const [{ data: ids }, { data: grants }] = await Promise.all([
    db.from("global_admin_pubkeys").select("global_admin_wallet,enc_public_key,identity_sig").not("identity_sig", "is", null),
    db.from("global_key_grants").select("global_admin_wallet"),
  ]);
  const granted = new Set((grants ?? []).map((g) => g.global_admin_wallet));
  const pending = (ids ?? []).filter((i) => !granted.has(i.global_admin_wallet));
  return NextResponse.json({ pending });
}

export async function POST(req: Request) {
  const s = await requireRole(["global_admin"]);
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = supabaseService();

  // The caller must be a still-active global_admin AND already enrolled (holds the
  // secret). A removed admin — even within their session TTL — cannot issue grants.
  if (!(await isActiveGlobalAdmin(db, s.wallet_pubkey))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { data: self } = await db
    .from("global_key_grants")
    .select("global_admin_wallet")
    .eq("global_admin_wallet", s.wallet_pubkey)
    .maybeSingle();
  if (!self) return NextResponse.json({ error: "not_enrolled" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const grants: unknown[] = Array.isArray(body.grants) ? body.grants : [];
  if (grants.length === 0) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  // Only grant to wallets that are currently global_admins on the allowlist.
  const { data: admins } = await db
    .from("allowlist")
    .select("wallet_pubkey")
    .eq("role", "global_admin")
    .is("removed_at", null);
  const adminSet = new Set((admins ?? []).map((a) => a.wallet_pubkey));

  const candidates = grants
    .filter(
      (g: unknown): g is { global_admin_wallet: string; sealed_secret: string } =>
        typeof (g as { global_admin_wallet?: unknown }).global_admin_wallet === "string" &&
        typeof (g as { sealed_secret?: unknown }).sealed_secret === "string",
    )
    .filter((g) => adminSet.has(g.global_admin_wallet));

  // Insert-only: never overwrite an existing valid grant. A compromised enrolled admin
  // therefore cannot clobber a peer's grant to lock them out. Re-issuing a grant (e.g.
  // after key rotation) is handled by the dedicated re-keying flow, not here.
  const { data: existing } = await db
    .from("global_key_grants")
    .select("global_admin_wallet")
    .in("global_admin_wallet", candidates.map((g) => g.global_admin_wallet));
  const alreadyGranted = new Set((existing ?? []).map((g) => g.global_admin_wallet));

  const rows = candidates
    .filter((g) => !alreadyGranted.has(g.global_admin_wallet))
    .map((g) => ({
      global_admin_wallet: g.global_admin_wallet,
      sealed_secret: g.sealed_secret,
      granted_by: s.wallet_pubkey,
    }));
  if (rows.length === 0) return NextResponse.json({ error: "no_valid_grants" }, { status: 400 });

  const { error } = await db.from("global_key_grants").insert(rows);
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 400 });
  await db.from("audit_log").insert({
    action: "global.grant",
    actor_wallet: s.wallet_pubkey,
    metadata: { granted: rows.map((r) => r.global_admin_wallet) },
  });
  return NextResponse.json({ ok: true, granted: rows.length });
}
