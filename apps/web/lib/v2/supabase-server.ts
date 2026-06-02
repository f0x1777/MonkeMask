// Server-only Supabase client using the service-role key. NEVER import this into a
// client component — the service role bypasses RLS. All /v2 DB access goes through
// here, with the Next.js route layer enforcing per-session authorization.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function supabaseService(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server env not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
