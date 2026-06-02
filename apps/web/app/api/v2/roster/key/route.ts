import { NextResponse } from "next/server";

import { requireRole } from "../../../../../lib/v2/require-role";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// The ambassador's per-country key (CK) wrapped to their wallet KEK. The server only
// ever stores the wrapped (ciphertext) key — it can't unwrap it.
export async function GET() {
  const s = await requireRole(["ambassador"]);
  if (!s || !s.country) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data } = await supabaseService()
    .from("wrapped_keys")
    .select("wrapped_key,iv,key_version")
    .eq("wallet_pubkey", s.wallet_pubkey)
    .eq("scope", `country:${s.country}`)
    .is("superseded_at", null)
    .maybeSingle();
  return NextResponse.json({ scope: `country:${s.country}`, key: data ?? null });
}

// First-time: store the wrapped CK the client just generated.
export async function PUT(req: Request) {
  const s = await requireRole(["ambassador"]);
  if (!s || !s.country) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.wrapped_key !== "string" || typeof body.iv !== "string") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const { error } = await supabaseService().from("wrapped_keys").insert({
    wallet_pubkey: s.wallet_pubkey,
    scope: `country:${s.country}`,
    wrapped_key: body.wrapped_key,
    iv: body.iv,
  });
  if (error) {
    return NextResponse.json(
      { error: error.code === "23505" ? "already_exists" : "insert_failed" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
