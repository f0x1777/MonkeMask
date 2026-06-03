import { NextResponse } from "next/server";

import { requireRole } from "../../../../lib/v2/require-role";
import { supabaseService } from "../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

const GENERATIONS = new Set(["gen2", "gen3"]);

function validAsset(a: unknown): a is { generation: string; number: number; image_url: string } {
  const o = a as { generation?: unknown; number?: unknown; image_url?: unknown };
  return (
    typeof o.generation === "string" &&
    GENERATIONS.has(o.generation) &&
    typeof o.number === "number" &&
    Number.isInteger(o.number) &&
    o.number >= 0 &&
    typeof o.image_url === "string" &&
    o.image_url.startsWith("https://") &&
    o.image_url.length <= 2048
  );
}

// Ingest assets (the team loads the full library here). Bulk via { assets: [...] } or a
// single { generation, number, image_url }. super_admin / global_admin only.
export async function POST(req: Request) {
  const s = await requireRole(["super_admin", "global_admin"]);
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const list: unknown[] = Array.isArray(body.assets) ? body.assets : [body];
  const rows = list.filter(validAsset).map((a) => ({
    generation: a.generation,
    number: a.number,
    image_url: a.image_url,
    added_by: s.wallet_pubkey,
  }));
  if (rows.length === 0) return NextResponse.json({ error: "no_valid_assets" }, { status: 400 });
  const { error } = await supabaseService()
    .from("monke_assets")
    .upsert(rows, { onConflict: "generation,number" });
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 400 });
  return NextResponse.json({ ok: true, ingested: rows.length });
}

// Lookup: does this Gen2/Gen3 number exist in the catalog? (ambassadors pull monkes by
// number). Returns existence only — the image is served by /assets/image.
export async function GET(req: Request) {
  const s = await requireRole(["ambassador", "country_ambassador", "global_admin", "super_admin"]);
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const generation = sp.get("generation") ?? "";
  const number = Number(sp.get("number"));
  if (!GENERATIONS.has(generation) || !Number.isInteger(number)) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }
  const { data } = await supabaseService()
    .from("monke_assets")
    .select("generation,number")
    .eq("generation", generation)
    .eq("number", number)
    .maybeSingle();
  return NextResponse.json({ found: data != null });
}
