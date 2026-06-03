import { NextResponse } from "next/server";

import { b64decode } from "../../../../../lib/v2/bytes";
import { requireRole } from "../../../../../lib/v2/require-role";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// The chapter key (CK) is sealed to each chapter ambassador's identity, so several
// ambassadors of the same chapter share ONE roster. This route reports whether the
// chapter is initialised + the caller's own sealed grant, and lets the first ambassador
// initialise it (atomically, via the scope_keys PK).

function scopeFor(country: string) {
  return `chapter:${country}`;
}

// A nacl sealed box of a 32-byte key is 32+32+16 = 80 bytes -> 108 base64 chars.
function isValidSealedKey(s: unknown): s is string {
  if (typeof s !== "string" || s.length > 120) return false;
  try {
    return b64decode(s).length === 80;
  } catch {
    return false;
  }
}

export async function GET() {
  const s = await requireRole(["ambassador"]);
  if (!s || !s.country) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = supabaseService();
  const scope = scopeFor(s.country);

  const { data: marker } = await db.from("scope_keys").select("scope").eq("scope", scope).maybeSingle();
  const { data: mine } = await db
    .from("scoped_key_grants")
    .select("sealed_key")
    .eq("scope", scope)
    .eq("wallet_pubkey", s.wallet_pubkey)
    .is("superseded_at", null)
    .maybeSingle();

  return NextResponse.json({ initialised: marker != null, grant: mine ?? null });
}

// First ambassador of the chapter: seal the freshly generated CK to themselves. The
// scope_keys insert is the atomic gate — a concurrent second initialiser hits the PK
// and gets 409, so the chapter can never split into two CKs.
export async function POST(req: Request) {
  const s = await requireRole(["ambassador"]);
  if (!s || !s.country) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!isValidSealedKey(body.sealed_key)) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const db = supabaseService();
  const scope = scopeFor(s.country);

  const { error: markErr } = await db
    .from("scope_keys")
    .insert({ scope, created_by: s.wallet_pubkey });
  if (markErr) {
    // 23505 = unique violation: someone already initialised this chapter.
    return NextResponse.json(
      { error: markErr.code === "23505" ? "already_initialised" : "init_failed" },
      { status: markErr.code === "23505" ? 409 : 400 },
    );
  }

  const { error: grantErr } = await db.from("scoped_key_grants").insert({
    wallet_pubkey: s.wallet_pubkey,
    scope,
    sealed_key: body.sealed_key,
    granted_by: s.wallet_pubkey,
  });
  if (grantErr) {
    // Roll back the marker so init can be retried cleanly.
    await db.from("scope_keys").delete().eq("scope", scope);
    return NextResponse.json({ error: "init_failed" }, { status: 500 });
  }
  await db.from("audit_log").insert({
    action: "chapter.init",
    actor_wallet: s.wallet_pubkey,
    target_country: s.country,
  });
  return NextResponse.json({ ok: true });
}
