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

// DELETE /api/v2/admin/allowlist { wallet_pubkey, force? } -> deactivate (set removed_at).
// Guards against removing the LAST active ambassador of a chapter unless force=true
// (you'd have no day-to-day holder; a global admin could still recover). After removal a
// remaining holder must Re-key to cryptographically revoke the removed member.
export async function DELETE(req: Request) {
  const session = await requireRole(["super_admin"]);
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const wallet = body.wallet_pubkey;
  if (typeof wallet !== "string") return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const db = supabaseService();
  const { data: entry } = await db
    .from("allowlist")
    .select("role,country,removed_at")
    .eq("wallet_pubkey", wallet)
    .maybeSingle();
  if (!entry || entry.removed_at) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (entry.role === "super_admin") {
    return NextResponse.json({ error: "cannot_remove_super_admin" }, { status: 400 });
  }

  if (entry.role === "ambassador" && entry.country && body.force !== true) {
    const { data: others } = await db
      .from("allowlist")
      .select("wallet_pubkey")
      .eq("role", "ambassador")
      .eq("country", entry.country)
      .is("removed_at", null)
      .neq("wallet_pubkey", wallet);
    if ((others?.length ?? 0) === 0) {
      return NextResponse.json({ error: "last_ambassador" }, { status: 409 });
    }
  }

  await db.from("allowlist").update({ removed_at: new Date().toISOString() }).eq("wallet_pubkey", wallet);
  await db.from("audit_log").insert({
    action: "allowlist.remove",
    actor_wallet: session.wallet_pubkey,
    target_country: entry.country,
    metadata: { removed: wallet, role: entry.role },
  });
  return NextResponse.json({ ok: true });
}
