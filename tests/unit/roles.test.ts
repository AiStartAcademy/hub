import { describe, expect, it } from "bun:test";
import {
  ADMIN_ROLES,
  MANAGE_ROLES,
  getRoles,
  hasAnyRole,
  hasRole,
  isValidRole,
  primaryRole,
  serializeRoles,
} from "@/lib/roles";

describe("getRoles", () => {
  it("returns an empty array for null/undefined", () => {
    expect(getRoles(null)).toEqual([]);
    expect(getRoles(undefined)).toEqual([]);
  });

  it("wraps a bare legacy role string", () => {
    expect(getRoles("ADMIN")).toEqual(["ADMIN"]);
  });

  it("returns an empty string source as an empty array", () => {
    expect(getRoles("")).toEqual([]);
  });

  it("passes through an already-resolved roles array", () => {
    expect(getRoles(["ADMIN", "INSTRUCTOR"])).toEqual(["ADMIN", "INSTRUCTOR"]);
  });

  it("parses a populated roles JSON string on a user-shaped object", () => {
    expect(getRoles({ role: "STUDENT", roles: '["ADMIN","INSTRUCTOR"]' })).toEqual([
      "ADMIN",
      "INSTRUCTOR",
    ]);
  });

  it("falls back to legacy role when roles is null", () => {
    expect(getRoles({ role: "TEAM_MEMBER", roles: null })).toEqual(["TEAM_MEMBER"]);
  });

  it("falls back to legacy role when roles is an empty array JSON string", () => {
    expect(getRoles({ role: "TEAM_MEMBER", roles: "[]" })).toEqual(["TEAM_MEMBER"]);
  });

  it("falls back to legacy role when roles is malformed JSON, without throwing", () => {
    expect(() => getRoles({ role: "ADMIN", roles: "not json" })).not.toThrow();
    expect(getRoles({ role: "ADMIN", roles: "not json" })).toEqual(["ADMIN"]);
  });

  it("resolves to an empty array when both role and roles are absent", () => {
    expect(getRoles({})).toEqual([]);
  });
});

describe("hasRole / hasAnyRole", () => {
  it("hasRole matches a single role in a multi-role set", () => {
    const user = { role: "ADMIN", roles: '["ADMIN","INSTRUCTOR"]' };
    expect(hasRole(user, "ADMIN")).toBe(true);
    expect(hasRole(user, "INSTRUCTOR")).toBe(true);
    expect(hasRole(user, "STUDENT")).toBe(false);
  });

  it("hasAnyRole matches on overlap with an allowed set", () => {
    const user = { role: "STUDENT", roles: '["TEAM_MEMBER"]' };
    expect(hasAnyRole(user, MANAGE_ROLES)).toBe(true);
    expect(hasAnyRole(user, ADMIN_ROLES)).toBe(false);
  });

  it("hasAnyRole is false for a user with zero roles", () => {
    expect(hasAnyRole({ role: "", roles: "[]" }, ADMIN_ROLES)).toBe(false);
    expect(hasAnyRole(null, ADMIN_ROLES)).toBe(false);
  });

  it("treats EVENT_ORGANIZER as a non-manager role", () => {
    const user = { role: "STUDENT", roles: '["STUDENT","EVENT_ORGANIZER"]' };
    expect(hasRole(user, "EVENT_ORGANIZER")).toBe(true);
    expect(hasAnyRole(user, MANAGE_ROLES)).toBe(false);
  });

  it("never widens a malformed/empty roles value into full access", () => {
    // Anti-regression: an unreadable `roles` value must resolve to [] or the
    // legacy single role — never to "every role" — even against a broad allow-list.
    const user = { role: "STUDENT", roles: "{}" };
    expect(hasAnyRole(user, ADMIN_ROLES)).toBe(false);
    expect(hasRole(user, "ADMIN")).toBe(false);
  });

  it("hasAnyRole works with a bare legacy role string source", () => {
    expect(hasAnyRole("ADMIN", ADMIN_ROLES)).toBe(true);
    expect(hasAnyRole("STUDENT", ADMIN_ROLES)).toBe(false);
  });
});

describe("primaryRole", () => {
  it("returns the first role in a multi-role set", () => {
    expect(primaryRole({ role: "STUDENT", roles: '["ADMIN","INSTRUCTOR"]' })).toBe("ADMIN");
  });

  it("defaults to STUDENT when no roles resolve", () => {
    expect(primaryRole(null)).toBe("STUDENT");
  });
});

describe("isValidRole / serializeRoles", () => {
  it("validates known role values only", () => {
    expect(isValidRole("ADMIN")).toBe(true);
    expect(isValidRole("EVENT_ORGANIZER")).toBe(true);
    expect(isValidRole("SUPERUSER")).toBe(false);
    expect(isValidRole(123)).toBe(false);
  });

  it("serializes a roles array as JSON", () => {
    expect(serializeRoles(["ADMIN", "INSTRUCTOR"])).toBe('["ADMIN","INSTRUCTOR"]');
    expect(JSON.parse(serializeRoles([]))).toEqual([]);
  });
});
