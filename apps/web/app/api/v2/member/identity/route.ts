import { NextResponse } from "next/server";

import { b64decode } from "../../../../../lib/v2/bytes";
import { requireRole } from "../../../../../lib/v2/require-role";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// A member's derived encryption identity public key (one per wallet, reused across
// scopes). Registering it lets an existing holder seal a scope key to them. Plaintext
// public key — safe to store.

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

function isValidEncPubKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length > 48 || !B64.test(key)) return false;
  try {
    return b64decode(key).length === 32; // X25519 public key is exactly 32 bytes
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  // global_admin registers a member identity too, so chapter CKs can be sealed to them
  // as recovery (break-glass) holders.
  const s = await requireRole(["ambassador", "country_ambassador", "global_admin"]);
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!isValidEncPubKey(body.enc_public_key)) {
    return NextResponse.json({ error: "invalid_key" }, { status: 400 });
  }
  const { error } = await supabaseService()
    .from("member_identities")
    .upsert({ wallet_pubkey: s.wallet_pubkey, enc_public_key: body.enc_public_key }, { onConflict: "wallet_pubkey" });
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
