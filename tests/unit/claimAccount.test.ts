import { beforeEach, describe, expect, it, mock } from "bun:test";
import { NextRequest } from "next/server";

type DataRecord = Record<string, unknown>;

type UserCreateArgs = {
  data: DataRecord;
};

const userCreateCalls: UserCreateArgs[] = [];

const prismaMock = {
  user: {
    findUnique: async (): Promise<null> => null,
    create: async (args: UserCreateArgs): Promise<DataRecord> => {
      userCreateCalls.push(args);
      return { id: "user-1", ...args.data };
    },
  },
  contact: {
    findUnique: async (): Promise<DataRecord> => ({
      name: "Stored Contact Name",
      birthday: "1990-04-17",
      attribution: '{"utm_source":"stored-contact"}',
    }),
  },
};

const actualPrisma = await import("@/lib/prisma");
mock.module("@/lib/prisma", () => ({
  ...actualPrisma,
  default: prismaMock,
}));

const actualTokens = await import("@/lib/tokens");
mock.module("@/lib/tokens", () => ({
  ...actualTokens,
  generateVerificationToken: async (): Promise<{
    identifier: string;
    token: string;
  }> => ({
    identifier: "lead@example.com",
    token: "fake-verification-token",
  }),
}));

const actualMail = await import("@/lib/mail");
mock.module("@/lib/mail", () => ({
  ...actualMail,
  sendVerificationEmail: async (): Promise<void> => undefined,
}));

const actualLinking = await import("@/lib/leads/linking");
mock.module("@/lib/leads/linking", () => ({
  ...actualLinking,
  autoLinkContactForUser: async (): Promise<void> => undefined,
}));

const actualRateLimit = await import("@/lib/rateLimit");
mock.module("@/lib/rateLimit", () => ({
  ...actualRateLimit,
  checkRateLimit: (): { limited: false; retryAfterSeconds: 0 } => ({
    limited: false,
    retryAfterSeconds: 0,
  }),
}));

const { POST } = await import("@/app/api/lead/claim-account/route");

beforeEach(() => {
  userCreateCalls.length = 0;
});

describe("lead claim account", () => {
  it("SC-20: user.create copies the Contact birthday and falls back to stored Contact attribution without a cookie", async () => {
    const request = new NextRequest("https://hub.example/api/lead/claim-account", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "lms_contact_email=lead%40example.com",
      },
      body: JSON.stringify({
        name: "Claimed Account",
        password: "StrongPass1!",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(userCreateCalls).toHaveLength(1);
    expect(userCreateCalls[0].data.birthday).toBe("1990-04-17");
    expect(userCreateCalls[0].data.attribution).toBe(
      '{"utm_source":"stored-contact"}',
    );
  });
});
