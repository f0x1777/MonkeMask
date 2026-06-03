import { NextResponse } from "next/server";

import { countryOf, isChapter, isCountry } from "../../../../lib/v2/chapters";
import { requireActiveRole } from "../../../../lib/v2/require-role";
import { supabaseService } from "../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// A country ambassador reads any chapter within THEIR country, via the CK that chapter's
// ambassadors sealed to them (they are entitled holders of every chapter in the country).
// Returns their sealed grant + the chapter's records; they open it client-side.
export async function GET(req: Request) {
  // requireActiveRole: a removed country ambassador is cut off immediately (not after JWT TTL).
  const s = await requireActiveRole(["country_ambassador"]);
  if (!s || !s.country || !isCountry(s.country)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const chapter = new URL(req.url).searchParams.get("chapter");
  if (!chapter || !isChapter(chapter) || countryOf(chapter) !== s.country) {
    return NextResponse.json({ error: "invalid_chapter" }, { status: 400 });
  }

  const db = supabaseService();
  const scope = `chapter:${chapter}`;
  const { data: grant } = await db
    .from("scoped_key_grants")
    .select("sealed_key")
    .eq("scope", scope)
    .eq("wallet_pubkey", s.wallet_pubkey)
    .is("superseded_at", null)
    .maybeSingle();
  if (!grant) {
    return NextResponse.json({ grant: null, records: [] }, { headers: { "cache-control": "no-store" } });
  }

  const { data: records } = await db
    .from("encrypted_roster_records")
    .select("id,person_id,ciphertext,iv")
    .eq("country", chapter);
  await db.from("audit_log").insert({
    action: "country.read",
    actor_wallet: s.wallet_pubkey,
    target_country: chapter,
  });
  return NextResponse.json({ grant, records: records ?? [] }, { headers: { "cache-control": "no-store" } });
}
