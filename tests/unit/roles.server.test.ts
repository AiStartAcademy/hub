import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const findUniqueCalls: Array<Record<string, unknown>> = [];
const updateManyCalls: Array<Record<string, unknown>> = [];
let findUniqueResult: { role: string | null; roles: string | null } | null = null;
let updateManyCount = 1;

mock.module("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: async (args: Record<string, unknown>) => {
        findUniqueCalls.push(args);
        return findUniqueResult;
      },
      updateMany: async (args: Record<string, unknown>) => {
        updateManyCalls.push(args);
        return { count: updateManyCount };
      },
    },
  },
}));

const { addRole } = await import("@/lib/roles.server");

describe("addRole", () => {
  beforeEach(() => {
    findUniqueCalls.length = 0;
    updateManyCalls.length = 0;
    findUniqueResult = null;
    updateManyCount = 1;
  });

  it("appends the new role and preserves the existing primary role", async () => {
    findUniqueResult = {
      role: "ADMIN",
      roles: '["ADMIN","INSTRUCTOR"]',
    };

    await addRole("user_123", "EVENT_ORGANIZER");

    expect(findUniqueCalls).toHaveLength(1);
    expect(updateManyCalls).toHaveLength(1);
    expect(updateManyCalls[0]).toMatchObject({
      where: { id: "user_123" },
      data: {
        role: "ADMIN",
        roles: '["ADMIN","INSTRUCTOR","EVENT_ORGANIZER"]',
      },
    });
  });

  it("returns without writing when the role is already present", async () => {
    findUniqueResult = {
      role: "STUDENT",
      roles: '["STUDENT","EVENT_ORGANIZER"]',
    };

    await addRole("user_123", "EVENT_ORGANIZER");

    expect(findUniqueCalls).toHaveLength(1);
    expect(updateManyCalls).toHaveLength(0);
  });

  it("preserves legacy-only roles instead of dropping them", async () => {
    findUniqueResult = {
      role: "TEAM_MEMBER",
      roles: null,
    };

    await addRole("user_123", "EVENT_ORGANIZER");

    expect(updateManyCalls[0]).toMatchObject({
      data: {
        role: "TEAM_MEMBER",
        roles: '["TEAM_MEMBER","EVENT_ORGANIZER"]',
      },
    });
  });

  it("throws with context when the user does not exist", async () => {
    await expect(addRole("missing_user", "EVENT_ORGANIZER")).rejects.toThrow(
      "Cannot add role EVENT_ORGANIZER to missing user missing_user"
    );
  });
});
