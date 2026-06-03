import { requireRole } from "../../../../../lib/v2/require-role";
import { supabaseService } from "../../../../../lib/v2/supabase-server";

export const runtime = "nodejs";

const GENERATIONS = new Set(["gen2", "gen3"]);

// Serve a catalog asset's image by Gen2/Gen3 number. The server fetches the stored URL
// (so the browser has no CORS issue and the source URL isn't exposed) and streams the
// bytes back. Ambassadors then add it as a monke via the normal upload path.
export async function GET(req: Request) {
  const s = await requireRole(["ambassador", "country_ambassador", "global_admin", "super_admin"]);
  if (!s) return new Response("forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const generation = sp.get("generation") ?? "";
  const number = Number(sp.get("number"));
  if (!GENERATIONS.has(generation) || !Number.isInteger(number)) {
    return new Response("invalid", { status: 400 });
  }

  const { data } = await supabaseService()
    .from("monke_assets")
    .select("image_url")
    .eq("generation", generation)
    .eq("number", number)
    .maybeSingle();
  if (!data?.image_url || !data.image_url.startsWith("https://")) {
    return new Response("not found", { status: 404 });
  }

  const upstream = await fetch(data.image_url).catch(() => null);
  if (!upstream || !upstream.ok) return new Response("upstream error", { status: 502 });
  const ct = upstream.headers.get("content-type") || "image/png";
  if (!ct.startsWith("image/")) return new Response("not an image", { status: 415 });
  const buf = await upstream.arrayBuffer();
  // Assets are immutable per number — cache privately.
  return new Response(buf, { headers: { "content-type": ct, "cache-control": "private, max-age=86400" } });
}
