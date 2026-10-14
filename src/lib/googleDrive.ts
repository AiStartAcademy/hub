// src/lib/googleDrive.ts
import { google } from "googleapis";
export { extractDriveFileId, driveUrlToProxy } from "./mediaUtils";
function normalizePrivateKey(key: string | undefined): string | undefined {
  if (!key) return key;
  // 1. Strip surrounding double or single quotes, if any
  let normalizedKey = key.replace(/^["']|["']$/g, "");
  // 2. Replace every literal \n with a real newline
  return normalizedKey.replace(/\\n/g, "\n");
}

// ─── Token cache ───────────────────────────────────────────
interface TokenCache {
  token: string;
  expiresAt: number; // Unix ms
}

let tokenCache: TokenCache | null = null;
// ──────────────────────────────────────────────────────────

export async function getDriveAccessToken(): Promise<string> {
  const now = Date.now();

  // Return the cached token while it has more than 60s left
  if (tokenCache && tokenCache.expiresAt - 60_000 > now) {
    return tokenCache.token;
  }

  const authClient = new google.auth.JWT({
    email: process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
    key: normalizePrivateKey(process.env.GOOGLE_DRIVE_PRIVATE_KEY),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  // authorize() returns credentials with expiry_date
  const credentials = await authClient.authorize();

  if (!credentials.access_token) {
    throw new Error("Failed to get Drive access token");
  }

  tokenCache = {
    token: credentials.access_token,
    // Google issues 3600s tokens; prefer expiry_date when present
    expiresAt: credentials.expiry_date ?? now + 3_600_000,
  };

  return tokenCache.token;
}

export function invalidateDriveTokenCache(): void {
  tokenCache = null;
  console.warn("[Drive] Token cache invalidated");
}