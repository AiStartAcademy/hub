import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  EMPTY_PERSON_CONTACT_STATE,
  resolvePersonContactStates,
} from "@/lib/leads/personRecord";
import prisma from "@/lib/prisma";
import { hasRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

export async function GET() {
  const session = await auth();

  if (!hasRole(session?.user, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const users = await prisma.user.findMany({
      // PII: phone and its consent state are joined in below and this payload
      // is ADMIN-only. If this route's authorization ever widens beyond ADMIN
      // (INSTRUCTOR, TEAM_MEMBER, …), phone must be dropped from the response.
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        roles: true,
        image: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // One batched Contact query for the whole page — never one per user.
    // Ships all four fields together: a bare number with no consent state
    // invites staff to dial someone who opted out.
    const personStates = await resolvePersonContactStates(users);

    return NextResponse.json(
      users.map((user) => ({
        ...user,
        ...(personStates.get(user.id) ?? EMPTY_PERSON_CONTACT_STATE),
      }))
    );
  } catch (error) {
    logger.error({ err: error }, "Fetch users error:");
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
