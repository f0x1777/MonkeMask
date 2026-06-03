import { NextResponse } from "next/server";

import { requireRole } from "../../../../../lib/v2/require-role";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// Per-person encrypted roster records for the ambassador's chapter. Each row is one
// face<->monke, encrypted client-side under the chapter CK. Independent rows -> no
// clobber on concurrent saves, and a single person can be reset (deleted).

const MAX_CIPHERTEXT = 1_500_000; // monke cutout data URL + embedding, generous bound

export async function GET() {
  const s = await requireRole(["ambassador"]);
  if (!s || !s.country) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data } = await supabaseService()
    .from("encrypted_roster_records")
    .select("id,person_id,ciphertext,iv")
    .eq("country", s.country)
    .order("updated_at", { ascending: true });
  return NextResponse.json({ records: data ?? [] });
}

// Upsert one person's record (insert, or update their monke if re-associated). Keyed on
// (country, person_id); the client reuses a person_id when a face matches a known one.
export async function POST(req: Request) {
  const s = await requireRole(["ambassador"]);
  if (!s || !s.country) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (
    typeof body.person_id !== "string" ||
    body.person_id.length > 64 ||
    typeof body.ciphertext !== "string" ||
    typeof body.iv !== "string" ||
    body.ciphertext.length > MAX_CIPHERTEXT
  ) {
    return NextResponse.json({ error: "invalid_record" }, { status: 400 });
  }
  const { error } = await supabaseService().from("encrypted_roster_records").upsert(
    {
      country: s.country,
      person_id: body.person_id,
      ciphertext: body.ciphertext,
      iv: body.iv,
      created_by: s.wallet_pubkey,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "country,person_id" },
  );
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 400 });
  return NextResponse.json({ ok: true });
}

// Reset a person: delete their record (sold/changed monke). Scoped to the caller's
// chapter so an ambassador can only delete within their own roster.
export async function DELETE(req: Request) {
  const s = await requireRole(["ambassador"]);
  if (!s || !s.country) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const personId = searchParams.get("person_id");
  if (!personId) return NextResponse.json({ error: "missing_person_id" }, { status: 400 });
  const { error } = await supabaseService()
    .from("encrypted_roster_records")
    .delete()
    .eq("country", s.country)
    .eq("person_id", personId);
  if (error) return NextResponse.json({ error: "delete_failed" }, { status: 400 });
  await supabaseService().from("audit_log").insert({
    action: "roster.reset_person",
    actor_wallet: s.wallet_pubkey,
    target_country: s.country,
  });
  return NextResponse.json({ ok: true });
}
