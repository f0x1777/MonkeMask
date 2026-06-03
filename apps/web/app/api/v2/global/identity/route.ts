import { NextResponse } from "next/server";

import { isValidEncPubKey } from "../../../../../lib/v2/identity-server";
import { requireRole } from "../../../../../lib/v2/require-role";
import { verifyIdentityBinding } from "../../../../../lib/v2/siws";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// A global_admin's encryption identity public key, derived from their wallet signature
// and signed by the wallet (binding), so an enroller can verify ownership before sealing
// the secret to it.

// Register (or update) the caller's own encryption public key + its binding signature.
export async function POST(req: Request) {
  const s = await requireRole(["global_admin"]);
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!isValidEncPubKey(body.enc_public_key)) {
    return NextResponse.json({ error: "invalid_key" }, { status: 400 });
  }
  if (
    typeof body.identity_sig !== "string" ||
    !verifyIdentityBinding(body.enc_public_key, body.identity_sig, s.wallet_pubkey)
  ) {
    return NextResponse.json({ error: "invalid_binding" }, { status: 400 });
  }
  const { error } = await supabaseService()
    .from("global_admin_pubkeys")
    .upsert(
      { global_admin_wallet: s.wallet_pubkey, enc_public_key: body.enc_public_key, identity_sig: body.identity_sig },
      { onConflict: "global_admin_wallet" },
    );
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 400 });
  return NextResponse.json({ ok: true });
}

// List registered admin identities (for an existing admin to enroll the ones missing a
// grant). Returns wallet + pubkey + binding sig — no secrets.
export async function GET() {
  const s = await requireRole(["global_admin"]);
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data } = await supabaseService()
    .from("global_admin_pubkeys")
    .select("global_admin_wallet,enc_public_key,identity_sig");
  return NextResponse.json({ identities: data ?? [] });
}
