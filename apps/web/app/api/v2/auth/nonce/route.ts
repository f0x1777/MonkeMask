import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// GET /api/v2/auth/nonce -> a single-use nonce (valid 5 min) the wallet signs.
export async function GET() {
  const nonce = randomBytes(32).toString("hex");
  const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { error } = await supabaseService().from("auth_nonces").insert({ nonce, expires_at });
  if (error) return NextResponse.json({ error: "nonce_issue_failed" }, { status: 500 });
  return NextResponse.json({ nonce }, { headers: { "cache-control": "no-store" } });
}
