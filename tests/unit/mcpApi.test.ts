import { describe, expect, it } from "bun:test";
import {
  boundedParam,
  MCP_DEFAULT_PAGE_SIZE,
  MCP_LIST_MAX_BYTES,
  MCP_MAX_PAGE_SIZE,
  mcpJsonLimited,
  parseJsonObject,
  parseJsonStringArray,
  parseMcpPagination,
} from "@/lib/mcpApi";

describe("MCP API helpers", () => {
  it("uses safe pagination defaults", () => {
    const parsed = parseMcpPagination(new URL("https://hub.test/internal"));
    expect(parsed).toEqual({ page: 1, pageSize: MCP_DEFAULT_PAGE_SIZE, skip: 0 });
  });

  it("caps page size and rejects invalid page values", () => {
    const parsed = parseMcpPagination(
      new URL("https://hub.test/internal?page=-4&pageSize=10000")
    );
    expect(parsed).toEqual({ page: 1, pageSize: MCP_MAX_PAGE_SIZE, skip: 0 });
  });

  it("bounds query strings", () => {
    const url = new URL(`https://hub.test/internal?q=${"a".repeat(500)}`);
    expect(boundedParam(url, "q", 20)).toHaveLength(20);
  });

  it("parses JSON string arrays defensively", () => {
    expect(parseJsonStringArray('["one",2,"two"]')).toEqual(["one", "two"]);
    expect(parseJsonStringArray("not-json")).toEqual([]);
    expect(parseJsonStringArray(null)).toEqual([]);
  });

  it("parses only JSON objects", () => {
    expect(parseJsonObject('{"utm_source":"meta"}')).toEqual({ utm_source: "meta" });
    expect(parseJsonObject("[]")).toBeNull();
    expect(parseJsonObject("not-json")).toBeNull();
  });

  it("refuses oversized serialized output", async () => {
    const res = mcpJsonLimited({ value: "x".repeat(MCP_LIST_MAX_BYTES) }, MCP_LIST_MAX_BYTES);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ maxBytes: MCP_LIST_MAX_BYTES });
  });
});
