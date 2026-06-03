import { NextResponse } from "next/server";

import { requireRole } from "../../../../../lib/v2/require-role";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// Enrollment. An already-enrolled global_admin (one who holds the secret) seals it to
// each pending admin's registered encryption pubkey and posts the grants. No handshake:
// the pending admin just needs to have registered their identity.

// Pending = a registered admin identity that has no grant yet. Returns the wallet +
// pubkey so the caller can seal the secret to each.
export async function GET() {
  const s = await requireRole(["global_admin"]);
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = supabaseService();
  const [{ data: ids }, { data: grants }] = await Promise.all([
    db.from("global_admin_pubkeys").select("global_admin_wallet,enc_public_key"),
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

  // Only an enrolled reader (one who already holds the secret) may issue grants.
  const { data: self } = await db
    .from("global_key_grants")
    .select("global_admin_wallet")
    .eq("global_admin_wallet", s.wallet_pubkey)
    .maybeSingle();
  if (!self) return NextResponse.json({ error: "not_enrolled" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const grants: unknown[] = Array.isArray(body.grants) ? body.grants : [];
  if (grants.length === 0) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  // Only grant to wallets that are actually global_admins on the allowlist.
  const { data: admins } = await db
    .from("allowlist")
    .select("wallet_pubkey")
    .eq("role", "global_admin")
    .is("removed_at", null);
  const adminSet = new Set((admins ?? []).map((a) => a.wallet_pubkey));

  const rows = grants
    .filter(
      (g: unknown): g is { global_admin_wallet: string; sealed_secret: string } =>
        typeof (g as { global_admin_wallet?: unknown }).global_admin_wallet === "string" &&
        typeof (g as { sealed_secret?: unknown }).sealed_secret === "string",
    )
    .filter((g) => adminSet.has(g.global_admin_wallet))
    .map((g) => ({
      global_admin_wallet: g.global_admin_wallet,
      sealed_secret: g.sealed_secret,
      granted_by: s.wallet_pubkey,
    }));
  if (rows.length === 0) return NextResponse.json({ error: "no_valid_grants" }, { status: 400 });

  const { error } = await db.from("global_key_grants").upsert(rows, { onConflict: "global_admin_wallet" });
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 400 });
  await db.from("audit_log").insert({
    action: "global.grant",
    actor_wallet: s.wallet_pubkey,
    metadata: { granted: rows.map((r) => r.global_admin_wallet) },
  });
  return NextResponse.json({ ok: true, granted: rows.length });
}
