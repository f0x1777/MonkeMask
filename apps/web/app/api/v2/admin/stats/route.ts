import { NextResponse } from "next/server";

import { requireRole } from "../../../../../lib/v2/require-role";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// GET /api/v2/admin/stats -> per-country roster counts WITHOUT the face data.
// Selects only the plaintext metadata (country, record_count, updated_at); the
// encrypted ciphertext column is never read here, so admins see "how many" without
// "who". super_admin + global_admin only.
export async function GET() {
  const session = await requireRole(["super_admin", "global_admin"]);
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data } = await supabaseService()
    .from("encrypted_country_rosters")
    .select("country,record_count,updated_at")
    .order("country", { ascending: true });

  const total = (data ?? []).reduce((n, r) => n + (r.record_count ?? 0), 0);
  return NextResponse.json({ rosters: data ?? [], total });
}
