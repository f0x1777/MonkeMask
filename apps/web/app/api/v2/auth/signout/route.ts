import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { REFRESH_COOKIE, SESSION_COOKIE } from "../../../../../lib/v2/session";

export const runtime = "nodejs";

// POST /api/v2/auth/signout -> clears the session cookies.
export async function POST() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(REFRESH_COOKIE);
  return NextResponse.json({ ok: true });
}
