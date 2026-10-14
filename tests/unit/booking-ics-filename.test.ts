import { describe, expect, it } from "bun:test";

import { leadBookingIcsFilename } from "@/lib/bookingIcs";

describe("leadBookingIcsFilename", () => {
  it("SC-4 derives the attachment filename from the configured prefix", () => {
    expect(leadBookingIcsFilename("academy")).toBe("academy-1-on-1.ics");
  });
});
