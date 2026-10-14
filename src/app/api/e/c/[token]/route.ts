// src/app/api/e/c/[token]/route.ts
//
// Click redirect. Public and unauthenticated — the caller is a reader following
// a link in an email.
//
// SECURITY: the destination lives INSIDE the HMAC-signed token, so this endpoint
// can never be turned into an open redirect. A tampered, expired-format, or
// unsigned token redirects to the app root and records nothing; we never read a
// destination from the query string or any other caller-controlled input.
//
// Rule: the reader always ends up somewhere sensible. A failed database write
// must not strand them on an error page.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { verifyToken, hashIp } from "@/lib/drip/tracking";

export const dynamic = "force-dynamic";

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

function redirect(to: string): NextResponse {
  const res = NextResponse.redirect(to, 307);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  let destination = appUrl();

  try {
    const { token } = await params;
    const payload = await verifyToken(token);

    // Not a valid click token — go to the root, record nothing.
    if (!payload || payload.k !== "c") return redirect(destination);

    // verifyToken already guaranteed this is an http(s) URL.
    destination = payload.u;

    if (payload.t === "drip") {
      const send = await prisma.dripSend.findUnique({
        where: { id: payload.s },
        select: { id: true, subject: true, firstClickedAt: true },
      });
      if (!send) return redirect(destination);

      await prisma.emailEvent.create({
        data: {
          contactId: payload.c,
          dripSendId: send.id,
          type: "CLICKED",
          url: payload.u.slice(0, 2000),
          subject: send.subject,
          userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
          ipHash: await hashIp(clientIp(req)),
        },
      });

      // First click only — a rollup, not a counter.
      if (!send.firstClickedAt) {
        await prisma.dripSend.update({
          where: { id: send.id },
          data: { firstClickedAt: new Date() },
        });
      }

      await prisma.contact.update({
        where: { id: payload.c },
        data: { lastActivityAt: new Date() },
      });
    } else {
      const source = await prisma.emailEvent.findUnique({
        where: { id: payload.s },
        select: { contactId: true, subject: true, type: true, metadata: true },
      });
      if (!isTrackableOneOffSource(source, payload.c)) return redirect(destination);

      await prisma.emailEvent.create({
        data: {
          contactId: payload.c,
          dripSendId: null,
          type: "CLICKED",
          url: payload.u.slice(0, 2000),
          subject: source.subject,
          source: "hub",
          metadata: JSON.stringify({ kind: "oneoff", sourceEmailEventId: payload.s }),
          userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
          ipHash: await hashIp(clientIp(req)),
        },
      });
      await prisma.contact.update({
        where: { id: payload.c },
        data: { lastActivityAt: new Date() },
      });
    }
  } catch (error) {
    logger.error({ err: error }, "[track:click] failed to record click");
  }

  return redirect(destination);
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
