import { describe, expect, it } from "bun:test";
import { isPasswordValid } from "@/lib/password";

describe("isPasswordValid", () => {
  it("accepts a password meeting every rule", () => {
    expect(isPasswordValid("Abcdef1!")).toBe(true);
  });

  it("rejects passwords shorter than 8 characters", () => {
    expect(isPasswordValid("Abc1!")).toBe(false);
  });

  it("requires an uppercase letter", () => {
    expect(isPasswordValid("abcdef1!")).toBe(false);
  });

  it("requires a lowercase letter", () => {
    expect(isPasswordValid("ABCDEF1!")).toBe(false);
  });

  it("requires a digit", () => {
    expect(isPasswordValid("Abcdefg!")).toBe(false);
  });

  it("requires a special character", () => {
    expect(isPasswordValid("Abcdefg1")).toBe(false);
  });
});
