// Session JWT for the /v2 platform. Signed with OUR own secret (V2_JWT_SECRET), not
// Supabase's — all Supabase access is server-side via the service role, with the
// Next.js layer enforcing authorization from these claims. (RLS stays as a backstop.)

import { SignJWT, jwtVerify } from "jose";

import type { V2Session } from "./session";

const SESSION_TTL = "15m";

function secret(): Uint8Array {
  const s = process.env.V2_JWT_SECRET;
  if (!s) throw new Error("V2_JWT_SECRET is not set");
  return new TextEncoder().encode(s);
}

/** Mint a short-lived HS256 session token carrying the ambassador's claims. */
export async function mintSession(s: V2Session): Promise<string> {
  return new SignJWT({ wallet_pubkey: s.wallet_pubkey, role: s.role, country: s.country })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secret());
}

/** Verify + decode a session token. Returns null on missing/expired/tampered. */
export async function getSession(token: string | undefined): Promise<V2Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.wallet_pubkey !== "string" || typeof payload.role !== "string") {
      return null;
    }
    return {
      wallet_pubkey: payload.wallet_pubkey,
      role: payload.role as V2Session["role"],
      country: (payload.country as string | null) ?? null,
    };
  } catch {
    return null;
  }
}
