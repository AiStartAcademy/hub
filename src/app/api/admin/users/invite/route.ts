// src/app/api/admin/users/invite/route.ts

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sendInviteEmail } from "@/lib/mail";
import { logger } from "@/lib/logger";
import { autoLinkContactForUser } from "@/lib/leads/linking";
import { generateAccountSetupToken } from "@/lib/tokens";

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  try {
    const session = await auth();
    
    // Authorization strict check
    if (!session?.user || session.user.role !== "ADMIN") {
      return new NextResponse("Unauthorized", { status: 403 });
    }

    const { emails, role } = await req.json();

    if (!Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json({ error: "No valid emails provided" }, { status: 400 });
    }

    let successCount = 0;
    let failedCount = 0;

    for (const email of emails) {
      let createdUserId: string | null = null;
      let createdToken: string | null = null;
      
      try {
        const existingUser = await prisma.user.findUnique({
          where: { email },
        });

        if (existingUser) {
          logger.info(`[INVITE_SKIP] User ${email} already exists`);
          failedCount++;
          continue; 
        }

        // 1. Create a placeholder user 
        const newUser = await prisma.user.create({
          data: { email, role },
        });
        
        createdUserId = newUser.id;

        // 2. Generate secure signup token
        const verificationToken = await generateAccountSetupToken(
          email,
          { ttlMs: INVITE_EXPIRY_MS }
        );
        createdToken = verificationToken.token;

        // 3. Send out SMTP Email
        const formattedRole =
          role === "TEAM_MEMBER"
            ? "Team Member"
            : role === "EVENT_ORGANIZER"
              ? "Event Organizer"
              : role.charAt(0) + role.slice(1).toLowerCase();
        await sendInviteEmail(email, verificationToken.token, formattedRole);

        // Contact linking is best-effort because it must never fail a completed invitation.
        void autoLinkContactForUser(newUser.id).catch((error: unknown) => {
          logger.error(
            { err: error, userId: newUser.id },
            `[INVITE_LINK_FAIL] Failed linking contact for ${email}:`
          );
        });
        
        logger.info(`[INVITE_SUCCESS] Sent invite to ${email} as ${role}`);
        successCount++;
        
      } catch (err) {
        logger.error({ err: err }, `[INVITE_FAIL] Failed processing for ${email}:`);
        
        // ROLLBACK: If email fails, delete the created user and token 
        // to prevent ghost accounts that cannot be invited again.
        if (createdUserId) {
          try {
            if (createdToken) {
              await prisma.verificationToken.delete({ where: { token: createdToken } });
            }
            await prisma.user.delete({ where: { id: createdUserId } });
            logger.info(`[INVITE_ROLLBACK] Successfully rolled back user ${email}`);
          } catch (rollbackErr) {
            logger.error({ err: rollbackErr }, `[INVITE_ROLLBACK_FAIL] Critical error rolling back user ${email}:`);
          }
        }
        
        failedCount++;
      }
    }

    return NextResponse.json({
      successCount,
      failedCount,
      message: `Successfully invited ${successCount} user(s). ${failedCount > 0 ? `(${failedCount} skipped due to duplicates/errors).` : ""}`
    });
    
  } catch (error) {
    logger.error({ err: error }, "[BULK_INVITE_ROUTE_ERROR]");
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
