import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { authenticateWallet, type AuthStore } from "../../../../../lib/v2/auth-verify";
import { mintSession } from "../../../../../lib/v2/jwt";
import { SESSION_COOKIE, type V2Role } from "../../../../../lib/v2/session";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

// POST /api/v2/auth/verify { pubkey, signature, nonce }
// Validates SIWS + the allowlist, then sets an httpOnly session cookie.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const db = supabaseService();

  const store: AuthStore = {
    async getNonce(nonce) {
      const { data } = await db
        .from("auth_nonces")
        .select("nonce,expires_at,consumed_at")
        .eq("nonce", nonce)
        .maybeSingle();
      return data ?? null;
    },
    async consumeNonce(nonce) {
      await db.from("auth_nonces").update({ consumed_at: new Date().toISOString() }).eq("nonce", nonce);
    },
    async getAllowlistEntry(pubkey) {
      const { data } = await db
        .from("allowlist")
        .select("role,country")
        .eq("wallet_pubkey", pubkey)
        .is("removed_at", null)
        .maybeSingle();
      return data ?? null;
    },
    async audit(action, actorWallet) {
      await db.from("audit_log").insert({ action, actor_wallet: actorWallet });
    },
  };

  const result = await authenticateWallet(body, store);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const token = await mintSession({
    wallet_pubkey: result.wallet_pubkey,
    role: result.role as V2Role,
    country: result.country,
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 15 * 60,
  });
  return NextResponse.json({ role: result.role, country: result.country });
}
