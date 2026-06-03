import { NextResponse } from "next/server";

import { isValidEncPubKey } from "../../../../../lib/v2/identity-server";
import { requireRole } from "../../../../../lib/v2/require-role";
import { verifyIdentityBinding } from "../../../../../lib/v2/siws";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// A member's derived encryption identity public key (one per wallet, reused across
// scopes). The wallet also signs the pubkey (binding), so an existing holder can verify
// the wallet really owns it before sealing a key to it — a compromised server can't
// substitute a pubkey at enroll time.
export async function POST(req: Request) {
  const s = await requireRole(["ambassador", "country_ambassador", "global_admin"]);
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
    .from("member_identities")
    .upsert(
      { wallet_pubkey: s.wallet_pubkey, enc_public_key: body.enc_public_key, identity_sig: body.identity_sig },
      { onConflict: "wallet_pubkey" },
    );
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
