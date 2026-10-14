// Admin integrations registry API — see docs/features/INTEGRATIONS.md.
// ADMIN only. Never serializes a decrypted secret to the client. Every mutation is audited
// (key + actor + action, never the value). Responses are no-store.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { encryptSecret, last4, secretsCryptoReady } from "@/lib/secretsCrypto";
import { bustSecretCache, getSecret } from "@/lib/secrets";
import { hasAnyRole, ADMIN_ROLES } from "@/lib/roles";
import { validateIntegrationValue } from "@/lib/integrations/validateIntegrationValue";

const CATEGORIES = ["llm", "mcp", "payments", "comms", "marketing", "endpoints", "other"];
const KINDS = ["secret", "config"];

function noStore(json: unknown, status = 200) {
  return NextResponse.json(json, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function requireAdmin() {
  const session = await auth();
  if (!hasAnyRole(session?.user, ADMIN_ROLES)) return null;
  return session;
}

// GET — list the registry. Secret kind exposes only last4; config kind exposes its value.
export async function GET() {
  const session = await requireAdmin();
  if (!session) return noStore({ error: "Forbidden" }, 403);

  const rows = await prisma.secret.findMany({ orderBy: [{ category: "asc" }, { key: "asc" }] });
  const items = rows.map((r) => ({
    key: r.key,
    category: r.category,
    kind: r.kind,
    description: r.description,
    // secret: masked identifier only. config: real value.
    value: r.kind === "config" ? r.valuePlain : null,
    last4: r.kind === "secret" ? r.last4 : null,
    isSet: r.kind === "config" ? r.valuePlain != null : r.valueEncrypted != null,
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt,
  }));
  return noStore({ items, cryptoReady: secretsCryptoReady() });
}

// PUT — upsert one key. Body: { key, category?, kind, value, description? }.
export async function PUT(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return noStore({ error: "Forbidden" }, 403);
  const actorId = (session.user as { id?: string })?.id ?? null;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return noStore({ error: "Invalid JSON" }, 400);
  }

  const key = typeof body.key === "string" ? body.key.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind : "secret";
  const category = typeof body.category === "string" ? body.category : "other";
  const description = typeof body.description === "string" ? body.description : null;
  const value = typeof body.value === "string" ? body.value : "";

  if (!/^[A-Z0-9_]{2,80}$/.test(key)) {
    return noStore({ error: "key must be UPPER_SNAKE_CASE (2–80 chars)" }, 400);
  }
  if (!KINDS.includes(kind)) return noStore({ error: "invalid kind" }, 400);
  if (!CATEGORIES.includes(category)) return noStore({ error: "invalid category" }, 400);
  if (value.length === 0) return noStore({ error: "value is required" }, 400);

  const validationError = validateIntegrationValue({
    key,
    value,
    twilioNumber: await getSecret("TWILIO_PHONE_NUMBER"),
  });
  if (validationError) return noStore({ error: validationError }, 400);

  const existing = await prisma.secret.findUnique({ where: { key } });

  const data: Record<string, unknown> = { key, category, kind, description, updatedBy: actorId };
  if (kind === "config") {
    data.valuePlain = value;
    data.valueEncrypted = null;
    data.iv = null;
    data.authTag = null;
    data.last4 = null;
  } else {
    if (!secretsCryptoReady()) {
      return noStore({ error: "Server misconfigured: SETTINGS_ENC_KEY unavailable" }, 500);
    }
    const enc = encryptSecret(value);
    data.valueEncrypted = enc.valueEncrypted;
    data.iv = enc.iv;
    data.authTag = enc.authTag;
    data.last4 = last4(value);
    data.valuePlain = null;
  }

  await prisma.secret.upsert({ where: { key }, create: data as never, update: data as never });
  await prisma.secretAudit.create({
    data: { key, action: existing ? "update" : "create", actorId },
  });
  bustSecretCache(key);

  return noStore({ ok: true, key, action: existing ? "update" : "create" });
}

// DELETE — remove a managed value (falls back to env again). ?key=NAME
export async function DELETE(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return noStore({ error: "Forbidden" }, 403);
  const actorId = (session.user as { id?: string })?.id ?? null;

  const key = new URL(req.url).searchParams.get("key")?.trim() ?? "";
  if (!key) return noStore({ error: "key is required" }, 400);

  const existing = await prisma.secret.findUnique({ where: { key } });
  if (!existing) return noStore({ error: "Not found" }, 404);

  await prisma.secret.delete({ where: { key } });
  await prisma.secretAudit.create({ data: { key, action: "delete", actorId } });
  bustSecretCache(key);

  return noStore({ ok: true, key, action: "delete" });
}
