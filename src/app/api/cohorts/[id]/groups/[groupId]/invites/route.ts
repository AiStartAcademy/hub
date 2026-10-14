import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  addUserToGroup,
  DuplicateGroupMembershipError,
} from "@/lib/groupMembership";
import { logger } from "@/lib/logger";
import { sendGroupInviteEmail } from "@/lib/mail";
import { normalizeEmail } from "@/lib/onboarding-security";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";
import { hasAnyRole, hasRole, MANAGE_ROLES } from "@/lib/roles";
import { generateAccountSetupToken } from "@/lib/tokens";

// Per-admin ceiling is generous so onboarding a full cohort in one sitting
// never trips it; the per-address limit stays tight to stop one inbox being
// hammered with repeated setup emails.
const INVITE_IP_LIMIT = 50;
const INVITE_EMAIL_LIMIT = 5;
const INVITE_WINDOW_MS = 15 * 60 * 1000;
const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

type InviteBody = {
  email?: unknown;
};

function parseInviteBody(body: unknown): InviteBody | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as InviteBody;
}

function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!hasAnyRole(session.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const ip = getClientIp(req);
    const ipLimit = checkRateLimit(
      `group-invite:ip:${ip}`,
      INVITE_IP_LIMIT,
      INVITE_WINDOW_MS
    );
    if (ipLimit.limited) {
      return NextResponse.json(
        { error: "Too many invitations. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(ipLimit.retryAfterSeconds) },
        }
      );
    }

    let body: InviteBody | null;
    try {
      body = parseInviteBody(await req.json());
    } catch {
      return NextResponse.json(
        { error: "Request body must be valid JSON." },
        { status: 400 }
      );
    }

    if (!body || typeof body.email !== "string") {
      return NextResponse.json(
        { error: "A valid email is required." },
        { status: 400 }
      );
    }

    const email = normalizeEmail(body.email);
    if (!email) {
      return NextResponse.json(
        { error: "A valid email is required." },
        { status: 400 }
      );
    }

    const emailLimit = checkRateLimit(
      `group-invite:email:${email}`,
      INVITE_EMAIL_LIMIT,
      INVITE_WINDOW_MS
    );
    if (emailLimit.limited) {
      return NextResponse.json(
        { error: "Too many invitations. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(emailLimit.retryAfterSeconds) },
        }
      );
    }

    const { id: cohortId, groupId } = await params;
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        cohort: { include: { instructors: { select: { id: true } } } },
      },
    });
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    // The URL cohort is what gets enrolled into, so the group must belong to it. Without this an
    // instructor of one cohort could enroll anyone into another through their own group.
    if (group.cohortId !== cohortId) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    if (
      hasRole(session.user, "INSTRUCTOR") &&
      !hasAnyRole(session.user, ["ADMIN", "TEAM_MEMBER"])
    ) {
      const isAssigned = group.cohort.instructors.some(
        (instructor) => instructor.id === session.user.id
      );
      if (!isAssigned) {
        return NextResponse.json(
          { error: "You are not assigned to this cohort" },
          { status: 403 }
        );
      }
    }

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, role: "STUDENT" },
      select: { id: true, password: true },
    });

    let member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: user.id } },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            role: true,
          },
        },
      },
    });
    const memberAlreadyExisted = member !== null;

    if (member && user.password) {
      return NextResponse.json(
        { error: "User is already in this group" },
        { status: 409 }
      );
    }

    if (!member) {
      try {
        member = await addUserToGroup(user.id, groupId, cohortId);
      } catch (error) {
        if (!(error instanceof DuplicateGroupMembershipError)) throw error;
        member = await prisma.groupMember.findUnique({
          where: { groupId_userId: { groupId, userId: user.id } },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                image: true,
                role: true,
              },
            },
          },
        });
        if (!member) throw error;
      }
    }

    const invited = !user.password;
    if (invited) {
      const setupToken = await generateAccountSetupToken(
        email,
        { ttlMs: INVITE_EXPIRY_MS }
      );
      await sendGroupInviteEmail(email, setupToken.token, {
        cohortTitle: group.cohort.title,
        groupName: group.name,
        cohortId,
      });
    }

    return NextResponse.json(
      { invited, member },
      { status: memberAlreadyExisted ? 200 : 201 }
    );
  } catch (error) {
    logger.error({ err: error }, "Invite group member error:");
    return NextResponse.json(
      { error: "Failed to invite member" },
      { status: 500 }
    );
  }
}
