import { cookies } from "next/headers";

import { getSession } from "./jwt";
import { SESSION_COOKIE, type V2Role, type V2Session } from "./session";
import { supabaseService } from "./supabase-server";

// Server-side gate for /api/v2/* route handlers. Returns the session if its role is
// allowed, else null (the caller responds 401/403).
export async function requireRole(allowed: V2Role[]): Promise<V2Session | null> {
  const session = await getSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session || !allowed.includes(session.role)) return null;
  return session;
}

// Like requireRole but ALSO re-validates the wallet against the live allowlist (role +
// removed_at), so a member removed mid-session is cut off immediately instead of waiting
// for their JWT to expire. Use on endpoints that return decryptable data of other scopes
// (cross-scope reads). super_admin isn't on the allowlist as a removable row, so it is
// checked by role only.
export async function requireActiveRole(allowed: V2Role[]): Promise<V2Session | null> {
  const session = await requireRole(allowed);
  if (!session) return null;
  if (session.role === "super_admin") return session;
  const { data } = await supabaseService()
    .from("allowlist")
    .select("role,removed_at")
    .eq("wallet_pubkey", session.wallet_pubkey)
    .maybeSingle();
  if (!data || data.removed_at || data.role !== session.role) return null;
  return session;
}
