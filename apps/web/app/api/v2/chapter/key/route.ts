import { NextResponse } from "next/server";

import { requireRole } from "../../../../../lib/v2/require-role";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// The chapter key (CK) is sealed to each chapter ambassador's identity, so several
// ambassadors of the same chapter share ONE roster. This route returns whether the
// chapter is initialised + the caller's own sealed grant, and lets the first ambassador
// initialise it (seal the CK to themselves).

function scopeFor(country: string) {
  return `chapter:${country}`;
}

export async function GET() {
  const s = await requireRole(["ambassador"]);
  if (!s || !s.country) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = supabaseService();
  const scope = scopeFor(s.country);

  const { data: any } = await db
    .from("scoped_key_grants")
    .select("wallet_pubkey")
    .eq("scope", scope)
    .is("superseded_at", null)
    .limit(1);
  const { data: mine } = await db
    .from("scoped_key_grants")
    .select("sealed_key")
    .eq("scope", scope)
    .eq("wallet_pubkey", s.wallet_pubkey)
    .is("superseded_at", null)
    .maybeSingle();

  return NextResponse.json({ initialised: (any?.length ?? 0) > 0, grant: mine ?? null });
}

// First ambassador of the chapter: seal the freshly generated CK to themselves.
export async function POST(req: Request) {
  const s = await requireRole(["ambassador"]);
  if (!s || !s.country) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.sealed_key !== "string") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const db = supabaseService();
  const scope = scopeFor(s.country);

  const { data: existing } = await db
    .from("scoped_key_grants")
    .select("wallet_pubkey")
    .eq("scope", scope)
    .is("superseded_at", null)
    .limit(1);
  if ((existing?.length ?? 0) > 0) {
    return NextResponse.json({ error: "already_initialised" }, { status: 409 });
  }
  const { error } = await db.from("scoped_key_grants").insert({
    wallet_pubkey: s.wallet_pubkey,
    scope,
    sealed_key: body.sealed_key,
    granted_by: s.wallet_pubkey,
  });
  if (error) return NextResponse.json({ error: "init_failed" }, { status: 400 });
  await db.from("audit_log").insert({
    action: "chapter.init",
    actor_wallet: s.wallet_pubkey,
    target_country: s.country,
  });
  return NextResponse.json({ ok: true });
}
