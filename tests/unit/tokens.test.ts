import { describe, expect, it } from "bun:test";
import { getAccountSetupEmail } from "@/lib/tokens";

describe("getAccountSetupEmail", () => {
  it("extracts the email from a prefixed identifier", () => {
    expect(getAccountSetupEmail("account-setup:lex@example.com")).toBe(
      "lex@example.com"
    );
  });

  it("returns null for a plain (non-setup) identifier", () => {
    expect(getAccountSetupEmail("lex@example.com")).toBeNull();
  });

  it("returns null when the prefix has no email after it", () => {
    expect(getAccountSetupEmail("account-setup:")).toBeNull();
  });
});
