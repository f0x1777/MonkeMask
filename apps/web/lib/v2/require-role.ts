import { cookies } from "next/headers";

import { getSession } from "./jwt";
import { SESSION_COOKIE, type V2Role, type V2Session } from "./session";

// Server-side gate for /api/v2/* route handlers. Returns the session if its role is
// allowed, else null (the caller responds 401/403).
export async function requireRole(allowed: V2Role[]): Promise<V2Session | null> {
  const session = await getSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session || !allowed.includes(session.role)) return null;
  return session;
}
