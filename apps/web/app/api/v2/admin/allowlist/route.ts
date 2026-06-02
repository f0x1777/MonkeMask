import { NextResponse } from "next/server";

import { validateNewEntry } from "../../../../../lib/v2/allowlist-admin";
import { requireRole } from "../../../../../lib/v2/require-role";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// GET /api/v2/admin/allowlist -> list entries (super_admin only).
export async function GET() {
  const session = await requireRole(["super_admin"]);
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data } = await supabaseService()
    .from("allowlist")
    .select("wallet_pubkey,role,country,added_at,removed_at,notes")
    .order("added_at", { ascending: true });
  return NextResponse.json({ entries: data ?? [] });
}

// POST /api/v2/admin/allowlist { wallet_pubkey, role, country? } -> onboard a
// global_admin or ambassador (super_admin only).
export async function POST(req: Request) {
  const session = await requireRole(["super_admin"]);
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const v = validateNewEntry(await req.json().catch(() => ({})));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const db = supabaseService();
  const { error } = await db.from("allowlist").insert({ ...v.value, added_by: session.wallet_pubkey });
  if (error) {
    const code = error.code === "23505" ? "already_exists" : "insert_failed";
    return NextResponse.json({ error: code }, { status: 400 });
  }
  await db.from("audit_log").insert({
    action: "allowlist.add",
    actor_wallet: session.wallet_pubkey,
    target_country: v.value.country,
    metadata: { added: v.value.wallet_pubkey, role: v.value.role },
  });
  return NextResponse.json({ ok: true });
}
