import { NextResponse } from "next/server";

import { requireRole } from "../../../../../lib/v2/require-role";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// A global_admin's encryption identity public key, derived from their wallet signature.
// Registering it lets any existing admin seal the global secret to them (enrollment) —
// the public key is safe to store in plaintext.

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

// Register (or update) the caller's own encryption public key.
export async function POST(req: Request) {
  const s = await requireRole(["global_admin"]);
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const key = body.enc_public_key;
  // X25519 public key is 32 bytes -> 44 base64 chars.
  if (typeof key !== "string" || key.length > 64 || !B64.test(key)) {
    return NextResponse.json({ error: "invalid_key" }, { status: 400 });
  }
  const { error } = await supabaseService()
    .from("global_admin_pubkeys")
    .upsert({ global_admin_wallet: s.wallet_pubkey, enc_public_key: key }, { onConflict: "global_admin_wallet" });
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 400 });
  return NextResponse.json({ ok: true });
}

// List registered admin identities (for an existing admin to enroll the ones missing a
// grant). Returns wallet + pubkey only — no secrets.
export async function GET() {
  const s = await requireRole(["global_admin"]);
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data } = await supabaseService()
    .from("global_admin_pubkeys")
    .select("global_admin_wallet,enc_public_key");
  return NextResponse.json({ identities: data ?? [] });
}
