import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { generateVerificationToken } from "@/lib/tokens";
import { sendVerificationEmail } from "@/lib/mail";
import { ATTRIBUTION_COOKIE, parseAttributionCookie } from "@/lib/attribution";
import { isPasswordValid } from "@/lib/password";
import { logger } from "@/lib/logger";
import { autoLinkContactForUser } from "@/lib/leads/linking";

export async function POST(req: NextRequest) {
  try {
    const { name, email, password, callbackUrl, groupId } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!isPasswordValid(password)) {
      console.warn("[API Register] Rejected registration due to weak password");
      return Response.json({ error: "Password does not meet complexity requirements" }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json({ error: "User already exists" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Marketing attribution captured on landing (first-touch cookie).
    const attribution = parseAttributionCookie(req.cookies.get(ATTRIBUTION_COOKIE)?.value);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: "STUDENT", // Default role
        attribution: attribution ? JSON.stringify(attribution) : null,
      },
    });

    // Contact linking is best-effort because it must never fail account registration.
    void autoLinkContactForUser(user.id).catch((error: unknown) => {
      logger.error({ err: error, userId: user.id }, "[API Register] Contact auto-link failed");
    });

    // Email verification
    const verificationToken = await generateVerificationToken(email);
    await sendVerificationEmail(verificationToken.identifier, verificationToken.token, { callbackUrl, groupId });

    return NextResponse.json(
      { message: "Verification email sent!", userId: user.id },
      { status: 201 }
    );
  } catch (error) {
    logger.error({ err: error }, "Registration error:");
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
