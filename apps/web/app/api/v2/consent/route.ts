import { NextResponse } from "next/server";

import { requireRole } from "../../../../lib/v2/require-role";
import { supabaseService } from "../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// General consent (one per ambassador): acknowledges that using the tool runs face
// matching and contributes entries to the global registry. Not per-person.
const SUBJECT = "general";

async function hasConsent(wallet: string): Promise<boolean> {
  const { data } = await supabaseService()
    .from("consent_records")
    .select("id")
    .eq("granted_by", wallet)
    .eq("subject_ref", SUBJECT)
    .is("revoked_at", null)
    .maybeSingle();
  return !!data;
}

export async function GET() {
  const s = await requireRole(["ambassador"]);
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ granted: await hasConsent(s.wallet_pubkey) });
}

export async function POST() {
  const s = await requireRole(["ambassador"]);
  if (!s || !s.country) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!(await hasConsent(s.wallet_pubkey))) {
    const db = supabaseService();
    await db.from("consent_records").insert({
      country: s.country,
      subject_ref: SUBJECT,
      consent_type: "country_roster_enrollment",
      granted_by: s.wallet_pubkey,
    });
    await db.from("audit_log").insert({
      action: "consent.grant",
      actor_wallet: s.wallet_pubkey,
      target_country: s.country,
    });
  }
  return NextResponse.json({ ok: true });
}
