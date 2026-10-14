// src/app/api/e/o/[token]/route.ts
//
// Open pixel. Public and unauthenticated by necessity — the caller is a mail
// client fetching an image.
//
// Rule: ALWAYS return the GIF. An invalid token, an unconfigured secret, or a
// database that is down must never turn into a broken image in someone's inbox.
// Tracking is the side effect here; serving the pixel is the job.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { verifyToken, hashIp } from "@/lib/drip/tracking";

export const dynamic = "force-dynamic";

/** Smallest possible transparent GIF. */
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

/**
 * Multi-fetch clients (and Apple/Gmail image proxies) can request the same
 * pixel several times in a row. One OPENED row per minute per send is enough to
 * see that a message was opened without flooding the timeline.
 */
const DEDUPE_WINDOW_MS = 60_000;

function pixelResponse(): NextResponse {
  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const payload = await verifyToken(token);

    // Unverifiable token: serve the image, record nothing.
    if (!payload || payload.k !== "o") return pixelResponse();

    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    if (payload.t === "drip") {
      const recent = await prisma.emailEvent.findFirst({
        where: { dripSendId: payload.s, type: "OPENED", createdAt: { gte: since } },
        select: { id: true },
      });
      if (recent) return pixelResponse();

      const send = await prisma.dripSend.findUnique({
        where: { id: payload.s },
        select: { id: true, subject: true, openedAt: true },
      });

      if (send) {
        await prisma.emailEvent.create({
          data: {
            contactId: payload.c,
            dripSendId: send.id,
            type: "OPENED",
            subject: send.subject,
            userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
            ipHash: await hashIp(clientIp(req)),
          },
        });

        // First open only — this column is a rollup, not a counter.
        if (!send.openedAt) {
          await prisma.dripSend.update({
            where: { id: send.id },
            data: { openedAt: new Date() },
          });
        }

        await prisma.contact.update({
          where: { id: payload.c },
          data: { lastActivityAt: new Date() },
        });
      }
    } else {
      const source = await prisma.emailEvent.findUnique({
        where: { id: payload.s },
        select: { contactId: true, subject: true, type: true, metadata: true },
      });
      if (!isTrackableOneOffSource(source, payload.c)) return pixelResponse();

      const metadata = oneOffTrackingMetadata(payload.s);
      const recent = await prisma.emailEvent.findFirst({
        where: {
          contactId: payload.c,
          dripSendId: null,
          type: "OPENED",
          metadata,
          createdAt: { gte: since },
        },
        select: { id: true },
      });
      if (!recent) {
        await prisma.emailEvent.create({
          data: {
            contactId: payload.c,
            dripSendId: null,
            type: "OPENED",
            subject: source.subject,
            source: "hub",
            metadata,
            userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
            ipHash: await hashIp(clientIp(req)),
          },
        });
        await prisma.contact.update({
          where: { id: payload.c },
          data: { lastActivityAt: new Date() },
        });
      }
    }
  } catch (error) {
    logger.error({ err: error }, "[track:open] failed to record open");
  }

  return pixelResponse();
}

function oneOffTrackingMetadata(sourceEmailEventId: string): string {
  return JSON.stringify({ kind: "oneoff", sourceEmailEventId });
}

function isTrackableOneOffSource(
  source: { contactId: string; type: string; metadata: string | null } | null,
  contactId: string
): source is { contactId: string; type: string; metadata: string; subject: string | null } {
  if (!source || source.contactId !== contactId || source.type !== "SENT" || !source.metadata) {
    return false;
  }
  try {
    const metadata = JSON.parse(source.metadata) as unknown;
    return (
      typeof metadata === "object" &&
      metadata !== null &&
      (metadata as { kind?: unknown }).kind === "oneoff"
    );
  } catch {
    return false;
  }
}

function clientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}
