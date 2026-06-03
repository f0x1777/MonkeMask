import { NextResponse } from "next/server";

import { isChapter } from "../../../../lib/v2/chapters";
import { requireRole } from "../../../../lib/v2/require-role";
import { supabaseService } from "../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// Break-glass recovery: a global_admin opens a specific chapter via the CK that was
// sealed to them (recovery grant). Returns their sealed grant for the chapter + the
// chapter's encrypted records; the admin opens the grant client-side and decrypts. Only
// global_admins, and only if a recovery grant was actually sealed to them.
export async function GET(req: Request) {
  const s = await requireRole(["global_admin"]);
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const chapter = new URL(req.url).searchParams.get("chapter");
  if (!chapter || !isChapter(chapter)) return NextResponse.json({ error: "invalid_chapter" }, { status: 400 });

  const db = supabaseService();
  const scope = `chapter:${chapter}`;
  const { data: grant } = await db
    .from("scoped_key_grants")
    .select("sealed_key")
    .eq("scope", scope)
    .eq("wallet_pubkey", s.wallet_pubkey)
    .is("superseded_at", null)
    .maybeSingle();
  if (!grant) return NextResponse.json({ grant: null, records: [] }, { headers: { "cache-control": "no-store" } });

  const { data: records } = await db
    .from("encrypted_roster_records")
    .select("id,person_id,ciphertext,iv")
    .eq("country", chapter);
  await db.from("audit_log").insert({
    action: "chapter.recover_read",
    actor_wallet: s.wallet_pubkey,
    target_country: chapter,
  });
  return NextResponse.json({ grant, records: records ?? [] }, { headers: { "cache-control": "no-store" } });
}
