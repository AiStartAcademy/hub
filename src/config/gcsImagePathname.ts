import { GCS_BUCKET_FALLBACK } from "./catalog";

export function gcsImagePathname(
  env: { GCS_BUCKET_NAME?: string } = process.env as { GCS_BUCKET_NAME?: string },
  fallback: string = GCS_BUCKET_FALLBACK,
): string | null {
  const bucket = env.GCS_BUCKET_NAME || fallback;
  return bucket ? `/${bucket}/**` : null;
}
