import { describe, expect, it } from "bun:test";
import { GCS_BUCKET_FALLBACK } from "@/config/catalog";
import { gcsImagePathname } from "@/config/gcsImagePathname";

describe("gcsImagePathname", () => {
  it("derives the image path from the catalog fallback when the environment is unset", () => {
    const expected = GCS_BUCKET_FALLBACK ? `/${GCS_BUCKET_FALLBACK}/**` : null;
    expect(gcsImagePathname({})).toBe(expected);
  });

  it("uses the configured GCS bucket name", () => {
    expect(gcsImagePathname({ GCS_BUCKET_NAME: "foo" })).toBe("/foo/**");
  });

  it("returns null when neither the environment nor catalog supplies a bucket", () => {
    expect(gcsImagePathname({}, "")).toBeNull();
  });
});
