import { NextResponse } from "next/server";

import { requireRole } from "../../../../../lib/v2/require-role";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// A sealed entry is {embedding (~4 KB) + monke cutout data URL}. Generous but bounded
// so a single POST can't store an arbitrarily large blob.
const MAX_BLOB_CHARS = 1_000_000;
const READ_LIMIT = 5000;

// Sealed global entries. Ambassadors WRITE (seal to the global public key); only
// global_admins READ (they hold the secret key). The country is taken from the
// ambassador's session, never the body, so an ambassador can only contribute under
// their own chapter.

export async function POST(req: Request) {
  const s = await requireRole(["ambassador"]);
  if (!s || !s.country) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.sealed_blob !== "string") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (body.sealed_blob.length > MAX_BLOB_CHARS) {
    return NextResponse.json({ error: "blob_too_large" }, { status: 413 });
  }
  const db = supabaseService();
  const { error } = await db.from("encrypted_global_registry").insert({
    country: s.country,
    sealed_blob: body.sealed_blob,
    created_by: s.wallet_pubkey,
  });
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 400 });
  await db.from("audit_log").insert({
    action: "global.contribute",
    actor_wallet: s.wallet_pubkey,
    target_country: s.country,
  });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const s = await requireRole(["global_admin"]);
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data } = await supabaseService()
    .from("encrypted_global_registry")
    .select("sealed_blob,country")
    .order("created_at", { ascending: true })
    .limit(READ_LIMIT);
  return NextResponse.json({ entries: data ?? [] });
}
