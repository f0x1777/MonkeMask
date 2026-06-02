import { NextResponse } from "next/server";

import { requireRole } from "../../../../lib/v2/require-role";
import { supabaseService } from "../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// The encrypted country roster blob. ciphertext/iv are AES-GCM (encrypted client-side
// under the country key); record_count is plaintext metadata so admins see counts
// without the faces.
export async function GET() {
  const s = await requireRole(["ambassador"]);
  if (!s || !s.country) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data } = await supabaseService()
    .from("encrypted_country_rosters")
    .select("ciphertext,iv,record_count,updated_at")
    .eq("country", s.country)
    .maybeSingle();
  return NextResponse.json({ roster: data ?? null });
}

export async function PUT(req: Request) {
  const s = await requireRole(["ambassador"]);
  if (!s || !s.country) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (
    typeof body.ciphertext !== "string" ||
    typeof body.iv !== "string" ||
    typeof body.record_count !== "number"
  ) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const db = supabaseService();
  const { error } = await db.from("encrypted_country_rosters").upsert(
    {
      country: s.country,
      ciphertext: body.ciphertext,
      iv: body.iv,
      record_count: body.record_count,
      updated_by: s.wallet_pubkey,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "country" },
  );
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 400 });
  await db.from("audit_log").insert({
    action: "roster.save",
    actor_wallet: s.wallet_pubkey,
    target_country: s.country,
    metadata: { record_count: body.record_count },
  });
  return NextResponse.json({ ok: true });
}
