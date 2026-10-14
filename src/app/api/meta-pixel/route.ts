// Public, unauthenticated: serves the Meta Pixel id to the browser so the pixel
// can be enabled/rotated from Settings → Integrations (META_PIXEL_ID) without a
// rebuild — a NEXT_PUBLIC_ var would bake it into the bundle at build time.
// The pixel id is not a secret (it ships in the page of every site using Meta
// ads); the CAPI token stays server-side and is never exposed here.
import { NextResponse } from "next/server";
import { getSecret } from "@/lib/secrets";

// getSecret reads the DB — never evaluate at build time.
export const dynamic = "force-dynamic";

export async function GET() {
  const pixelId = (await getSecret("META_PIXEL_ID")) ?? null;
  return NextResponse.json(
    { pixelId },
    // Cache at the edge/browser briefly so every page view doesn't hit the DB;
    // 5 minutes matches the spirit of getSecret's own 30s in-process cache.
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
