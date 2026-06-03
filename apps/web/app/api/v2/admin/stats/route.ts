import { NextResponse } from "next/server";

import { requireRole } from "../../../../../lib/v2/require-role";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// GET /api/v2/admin/stats -> per-chapter roster counts WITHOUT the face data. Counts
// rows in encrypted_roster_records (the ciphertext is never read here), so admins see
// "how many" per chapter without "who". super_admin + global_admin only.
export async function GET() {
  const session = await requireRole(["super_admin", "global_admin"]);
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Pull only the plaintext country column and count per chapter in memory.
  const { data } = await supabaseService().from("encrypted_roster_records").select("country");
  const byCountry: Record<string, number> = {};
  for (const r of data ?? []) {
    const c = (r as { country: string }).country;
    byCountry[c] = (byCountry[c] ?? 0) + 1;
  }
  const rosters = Object.entries(byCountry)
    .map(([country, record_count]) => ({ country, record_count }))
    .sort((a, b) => a.country.localeCompare(b.country));
  return NextResponse.json({ rosters, total: data?.length ?? 0 });
}
