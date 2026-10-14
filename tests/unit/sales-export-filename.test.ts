import { describe, expect, it } from "bun:test";
import { brand } from "@/config/brand";
import { buildSalesExportFilename } from "@/lib/salesExport";

describe("buildSalesExportFilename", () => {
  it("uses the brand sales prefix and an ISO date", () => {
    expect(buildSalesExportFilename(new Date("2026-10-13T23:59:59.000Z"))).toBe(
      `${brand.ids.salesExportFilePrefix}-2026-10-13.csv`
    );
  });
});
