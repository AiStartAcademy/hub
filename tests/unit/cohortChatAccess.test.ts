import { describe, expect, test } from "bun:test";
import {
  canAccessCohortChat,
  cohortChannelName,
  slugifyCohortChannel,
} from "@/lib/chat/cohortChatAccess";

describe("canAccessCohortChat", () => {
  const student = { roles: ["STUDENT"] };
  const instructor = { roles: ["INSTRUCTOR"] };
  const admin = { roles: ["ADMIN"] };

  test("rejects a signed-in user not enrolled in that cohort", () => {
    expect(
      canAccessCohortChat({ user: student, groupMemberCount: 0, enrollmentCount: 0 }),
    ).toBe(false);
  });

  test("allows an enrolled student via enrollment row", () => {
    expect(
      canAccessCohortChat({ user: student, groupMemberCount: 0, enrollmentCount: 1 }),
    ).toBe(true);
  });

  test("allows an enrolled student via group membership", () => {
    expect(
      canAccessCohortChat({ user: student, groupMemberCount: 1, enrollmentCount: 0 }),
    ).toBe(true);
  });

  test("allows staff without enrollment", () => {
    expect(
      canAccessCohortChat({ user: instructor, groupMemberCount: 0, enrollmentCount: 0 }),
    ).toBe(true);
    expect(
      canAccessCohortChat({ user: admin, groupMemberCount: 0, enrollmentCount: 0 }),
    ).toBe(true);
  });

  test("rejects an absent user", () => {
    expect(
      canAccessCohortChat({ user: null, groupMemberCount: 5, enrollmentCount: 5 }),
    ).toBe(false);
  });
});

describe("cohortChannelName", () => {
  test("returns the persisted channel name when set, ignoring a renamed title", () => {
    expect(
      cohortChannelName({ title: "Renamed Cohort", rocketchatChannelName: "cohort-original-title" }),
    ).toBe("cohort-original-title");
  });

  test("derives from the title when no channel name is persisted", () => {
    expect(
      cohortChannelName({ title: "10-Day Intensive #3", rocketchatChannelName: null }),
    ).toBe("cohort-10-day-intensive--3");
  });

  test("slugify matches the legacy RocketChatService.syncCohortGroup rule", () => {
    // Legacy rule: lowercase, every non [a-z0-9] char becomes a single dash.
    expect(slugifyCohortChannel("AI Automation Agency Bootcamp")).toBe(
      "ai-automation-agency-bootcamp",
    );
  });
});
