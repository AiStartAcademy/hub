import type { NextConfig } from "next";
import { gcsImagePathname } from "./src/config/gcsImagePathname";

const gcsPathname = gcsImagePathname();

const nextConfig: NextConfig = {
  output: "standalone",
  // Lets a second `next dev` run against this repo without sharing (and
  // corrupting) the primary `.next` turbopack cache — set NEXT_DIST_DIR to an
  // alternate path. Unset in CI/production, so the default `.next` is used.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // The waiver and agreement templates are markdown read at runtime with
  // `fs.readFileSync` (src/lib/waiver.ts, src/lib/agreementTemplates.ts), and the
  // AISA countersignature PNG is read the same way (src/lib/aisaSignature.ts) so it
  // can be inlined as a data URI instead of being served from /public. Turbopack's
  // tracer cannot see those reads, so the files must be traced explicitly or the
  // standalone image throws ENOENT on first request to /waiver or the agreement APIs.
  outputFileTracingIncludes: {
    "/**": ["./src/content/**/*.md", "./src/content/signatures/*.png"],
  },
  images: {
    remotePatterns: gcsPathname
      ? [
          {
            protocol: "https",
            hostname: "storage.googleapis.com",
            pathname: gcsPathname,
          },
        ]
      : [],
  },
};

export default nextConfig;
