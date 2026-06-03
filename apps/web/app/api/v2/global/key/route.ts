import { NextResponse } from "next/server";

import { requireRole } from "../../../../../lib/v2/require-role";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// The global registry key. The PUBLIC key is readable by ambassadors (to seal writes)
// and global_admins; a global_admin's grant is the global secret SEALED to their own
// encryption identity — returned only to that admin, opened only by re-deriving their
// identity. A secret never lands here in plaintext.

export async function GET() {
  const s = await requireRole(["ambassador", "global_admin"]);
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = supabaseService();
  const { data: key } = await db
    .from("global_registry_key")
    .select("box_public_key")
    .eq("id", 1)
    .maybeSingle();

  let grant: { sealed_secret: string } | null = null;
  if (s.role === "global_admin") {
    const { data } = await db
      .from("global_key_grants")
      .select("sealed_secret")
      .eq("global_admin_wallet", s.wallet_pubkey)
      .maybeSingle();
    grant = data ?? null;
  }
  return NextResponse.json({ public_key: key?.box_public_key ?? null, grant });
}

// Initialise the registry: the first global_admin generates the box keypair client-side
// and posts the public key + the secret sealed to their OWN encryption identity. Once a
// key exists, re-init is refused (additional admins are enrolled via /global/grants).
export async function POST(req: Request) {
  const s = await requireRole(["global_admin"]);
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.box_public_key !== "string" || typeof body.sealed_secret !== "string") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const db = supabaseService();
  const { data: existing } = await db.from("global_registry_key").select("id").eq("id", 1).maybeSingle();
  if (existing) return NextResponse.json({ error: "already_initialised" }, { status: 409 });

  const { error: keyErr } = await db
    .from("global_registry_key")
    .insert({ id: 1, box_public_key: body.box_public_key, created_by: s.wallet_pubkey });
  if (keyErr) return NextResponse.json({ error: "init_failed" }, { status: 400 });

  // The self-grant is what makes the registry readable. If it fails, roll back the key
  // row so init can be retried cleanly.
  const { error: grantErr } = await db.from("global_key_grants").insert({
    global_admin_wallet: s.wallet_pubkey,
    sealed_secret: body.sealed_secret,
    granted_by: s.wallet_pubkey,
  });
  if (grantErr) {
    await db.from("global_registry_key").delete().eq("id", 1);
    return NextResponse.json({ error: "init_failed" }, { status: 500 });
  }
  await db.from("audit_log").insert({ action: "global.init", actor_wallet: s.wallet_pubkey });
  return NextResponse.json({ ok: true });
}
