import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { ATTRIBUTION_COOKIE, parseAttributionCookie } from "@/lib/attribution";
import { LEAD_EMAIL_COOKIE, LEAD_NAME_COOKIE } from "@/lib/lead-cookie";
import { sendVerificationEmail } from "@/lib/mail";
import { isPasswordValid } from "@/lib/password";
import { normalizeEmail, sanitizePlainText } from "@/lib/onboarding-security";
import { generateVerificationToken } from "@/lib/tokens";
import { checkRateLimit } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";
import { autoLinkContactForUser } from "@/lib/leads/linking";

type ClaimAccountBody = {
  password?: unknown;
  name?: unknown;
};

function parseClaimAccountBody(body: unknown): ClaimAccountBody | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as ClaimAccountBody;
}

const CLAIM_ACCOUNT_LIMIT = 5;
const CLAIM_ACCOUNT_WINDOW_MS = 15 * 60 * 1000;

function getClientIp(req: NextRequest): string {
  // Standard proxy header set by Cloudflare/nginx in front of this app; falls
  // back to a shared bucket if absent (e.g. local dev with no proxy).
  const forwardedFor = req.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`claim-account:ip:${ip}`, CLAIM_ACCOUNT_LIMIT, CLAIM_ACCOUNT_WINDOW_MS);
  if (ipLimit.limited) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
    );
  }

  let body: ClaimAccountBody | null = null;

  try {
    body = parseClaimAccountBody(await req.json());
  } catch (error) {
    logger.error({ err: error }, "[API /lead/claim-account] Invalid JSON body:");
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body.name !== undefined && typeof body.name !== "string") {
    return NextResponse.json({ error: "Name must be a string." }, { status: 400 });
  }

  if (typeof body.password !== "string" || !body.password) {
    return NextResponse.json({ error: "Password is required." }, { status: 400 });
  }

  if (!isPasswordValid(body.password)) {
    return NextResponse.json(
      { error: "Password does not meet complexity requirements." },
      { status: 400 }
    );
  }

  const email = normalizeEmail(req.cookies.get(LEAD_EMAIL_COOKIE)?.value);
  if (email) {
    // Second key on the email itself so a rotated-IP attacker still can't
    // hammer one specific address past the IP-scoped limit above.
    const emailLimit = checkRateLimit(`claim-account:email:${email}`, CLAIM_ACCOUNT_LIMIT, CLAIM_ACCOUNT_WINDOW_MS);
    if (emailLimit.limited) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(emailLimit.retryAfterSeconds) } }
      );
    }
  }
  if (!email) {
    return NextResponse.json(
      { error: "Missing or invalid lead cookie. Please unlock the lesson again." },
      { status: 400 }
    );
  }

  // No explicit timeout: Prisma work here is bounded by the enclosing request
  // lifecycle and must complete atomically within this route.
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    return NextResponse.json(
      {
        error: "You already have an account for this email. Please log in instead.",
        loginUrl: "/login",
      },
      { status: 409 }
    );
  }

  const requestedName = sanitizePlainText(body.name, 200);
  const cookieName = sanitizePlainText(req.cookies.get(LEAD_NAME_COOKIE)?.value, 200);

  // No explicit timeout: the contact lookup is same-database fallback data, bounded
  // by the request lifecycle just like the create below.
  const contact = await prisma.contact.findUnique({
    where: { email },
    select: { name: true, birthday: true, attribution: true },
  });
  const contactName = sanitizePlainText(contact?.name, 200);
  const resolvedName = requestedName || cookieName || contactName || undefined;

  // No explicit timeout: bcrypt hashing is CPU-bound local work and follows the
  // request lifecycle rather than a network deadline.
  const hashedPassword = await bcrypt.hash(body.password, 10);
  const attribution = parseAttributionCookie(req.cookies.get(ATTRIBUTION_COOKIE)?.value);

  // No explicit timeout: user creation is a local database write that must either
  // complete or fail within the request lifecycle.
  const user = await prisma.user.create({
    data: {
      name: resolvedName,
      email,
      password: hashedPassword,
      role: "STUDENT",
      // Copy durable Contact data now: the best-effort auto-link below is
      // intentionally voided and may complete after this response.
      birthday: contact?.birthday ?? undefined,
      attribution: attribution
        ? JSON.stringify(attribution)
        : contact?.attribution ?? null,
    },
  });

  // Contact linking is best-effort because it must never fail account creation.
  void autoLinkContactForUser(user.id).catch((error: unknown) => {
    logger.error(
      { err: error, userId: user.id },
      "[API /lead/claim-account] Contact auto-link failed"
    );
  });

  try {
    // Best effort only: verification mail should not block immediate access because
    // the user is signed in right after account creation under the current auth policy.
    const verificationToken = await generateVerificationToken(email);
    await sendVerificationEmail(verificationToken.identifier, verificationToken.token);
  } catch (error) {
    logger.error({ err: error }, "[API /lead/claim-account] Verification email failed:");
  }

  return NextResponse.json({ success: true, email }, { status: 201 });
}
