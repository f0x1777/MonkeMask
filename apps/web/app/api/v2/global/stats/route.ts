import { NextResponse } from "next/server";

import { requireRole } from "../../../../../lib/v2/require-role";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// Global registry counts. The country column is plaintext, so super_admin and
// global_admins can see HOW MANY entries exist per chapter without anyone reading the
// sealed faces. (Super_admin sees counts only — never the entries themselves.)
export async function GET() {
  const s = await requireRole(["super_admin", "global_admin"]);
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data } = await supabaseService()
    .from("encrypted_global_registry")
    .select("country");
  const rows = data ?? [];
  const byCountry: Record<string, number> = {};
  for (const r of rows) {
    const c = (r as { country: string | null }).country ?? "—";
    byCountry[c] = (byCountry[c] ?? 0) + 1;
  }
  const initialised =
    (await supabaseService().from("global_registry_key").select("id").eq("id", 1).maybeSingle()).data != null;
  return NextResponse.json({
    total: rows.length,
    by_country: Object.entries(byCountry).map(([country, count]) => ({ country, count })),
    initialised,
  });
}
