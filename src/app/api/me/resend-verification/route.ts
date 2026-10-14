import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { generateVerificationToken } from "@/lib/tokens";
import { sendVerificationEmail } from "@/lib/mail";
import { logger } from "@/lib/logger";

// POST /api/me/resend-verification — sends a fresh verification email to the
// logged-in user (no-op if already verified).
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });

  if (!user?.email) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (user.emailVerified) {
    return NextResponse.json({ message: "Email already verified." });
  }

  try {
    const token = await generateVerificationToken(user.email);
    await sendVerificationEmail(token.identifier, token.token);
    return NextResponse.json({ message: "Verification email sent." });
  } catch (error) {
    logger.error({ err: error }, "Resend verification error:");
    return NextResponse.json(
      { error: "Could not send verification email." },
      { status: 500 }
    );
  }
}
