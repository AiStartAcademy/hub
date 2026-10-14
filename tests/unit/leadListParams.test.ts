import { describe, expect, it } from "bun:test";
import {
  parseLeadListParams,
  serializeLeadListParams,
  type LeadListParamOptions,
  type LeadListUrlState,
} from "@/app/(dashboard)/admin/contacts/leadListParams";

const options: LeadListParamOptions = {
  sources: ["manual", "onboarding"],
  campaignNames: ["Welcome series"],
  tags: ["priority", "founder"],
};

const defaultState: LeadListUrlState = {
  search: "",
  statusFilter: "ALL",
  sourceFilter: "ALL",
  dripFilter: "ALL",
  tagFilter: [],
  sort: null,
  showExcluded: false,
};

describe("lead list URL params", () => {
  it("uses existing defaults when params are missing", () => {
    expect(parseLeadListParams(new URLSearchParams(), options)).toEqual(defaultState);
  });

  it("treats a blank search as empty", () => {
    expect(parseLeadListParams(new URLSearchParams("q=%20%20"), options)).toEqual(defaultState);
  });

  it("parses valid filters, repeated tags, and descending sort", () => {
    const params = new URLSearchParams(
      "q=Ada&status=QUALIFIED&source=manual&drip=Welcome+series&tag=priority&tag=founder&sort=added&dir=desc"
    );

    expect(parseLeadListParams(params, options)).toEqual({
      search: "Ada",
      statusFilter: "QUALIFIED",
      sourceFilter: "manual",
      dripFilter: "Welcome series",
      tagFilter: ["priority", "founder"],
      sort: { key: "added", dir: -1 },
      showExcluded: false,
    });
  });

  it("falls back safely for unknown and malformed values", () => {
    const params = new URLSearchParams(
      "status=INVALID&source=other&drip=missing&tag=unknown&sort=added&dir=sideways"
    );

    expect(parseLeadListParams(params, options)).toEqual(defaultState);
  });

  it("omits default values while preserving unrelated params", () => {
    const params = serializeLeadListParams(
      defaultState,
      new URLSearchParams("q=old&status=NEW&tag=priority&sort=name&dir=asc&view=compact")
    );

    expect(params.toString()).toBe("view=compact");
  });

  it("serializes non-default values for a parseable round trip", () => {
    const state: LeadListUrlState = {
      search: "Ada Lovelace",
      statusFilter: "WON",
      sourceFilter: "onboarding",
      dripFilter: "ACTIVE",
      tagFilter: ["founder"],
      sort: { key: "name", dir: 1 },
      showExcluded: true,
    };

    expect(parseLeadListParams(serializeLeadListParams(state), options)).toEqual(state);
  });

  it("SC-3: hides excluded contacts by default and round-trips an explicit show-excluded opt-in", () => {
    expect(parseLeadListParams(new URLSearchParams(), options).showExcluded).toBe(false);

    const state: LeadListUrlState = { ...defaultState, showExcluded: true };
    const serialized = serializeLeadListParams(state);

    expect(serialized.get("showExcluded")).toBe("true");
    expect(parseLeadListParams(serialized, options).showExcluded).toBe(true);
  });
});
