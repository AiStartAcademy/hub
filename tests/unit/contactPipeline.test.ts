import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("contact pipeline exclusion", () => {
  it("SC-1: Contact has exactly one additive excludeFromPipeline Boolean field defaulting false", () => {
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    const contact = schema.match(/model Contact \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const fields = contact.match(/excludeFromPipeline\s+Boolean\s+@default\(false\)/g) ?? [];

    expect(fields).toHaveLength(1);
  });

  it("SC-2: pipeline facets share the default exclusion predicate and report filtered, excluded, and raw totals", async () => {
    const { pipelineContactWhere, summarizePipelineCounts } = await import(
      "@/lib/leads/pipeline"
    );

    expect(pipelineContactWhere()).toEqual({ excludeFromPipeline: false });
    expect(summarizePipelineCounts([5, 4, 3], 7)).toEqual({
      pipelineContactCount: 12,
      excludedFromPipelineCount: 7,
      allContactCount: 19,
    });
  });
});

describe("lead update request", () => {
  it("SC-4: validates a small deduplicated batch and delegates status changes with distinct per-id conflicts", async () => {
    const { executeLeadUpdateBatch, parseLeadUpdateBatch } = await import(
      "@/lib/leads/update"
    );

    expect(
      parseLeadUpdateBatch({
        updates: [
          {
            id: " contact-1 ",
            status: " qualified ",
            expectedCurrentStatus: " contacted ",
            excludeFromPipeline: true,
            tags: [" partner ", "partner"],
          },
          { id: "contact-2", tags: [], tagMode: "replace" },
        ],
      })
    ).toEqual({
      ok: true,
      updates: [
        {
          id: "contact-1",
          status: "QUALIFIED",
          expectedCurrentStatus: "CONTACTED",
          excludeFromPipeline: true,
          tags: ["partner"],
          tagMode: "add",
        },
        { id: "contact-2", tags: [], tagMode: "replace" },
      ],
    });

    expect(parseLeadUpdateBatch({ updates: [] })).toMatchObject({ ok: false });
    expect(
      parseLeadUpdateBatch({
        updates: Array.from({ length: 51 }, (_, index) => ({
          id: `contact-${index}`,
          excludeFromPipeline: true,
        })),
      })
    ).toMatchObject({ ok: false, error: expect.stringContaining("50") });
    expect(
      parseLeadUpdateBatch({
        updates: [
          { id: "duplicate", excludeFromPipeline: true },
          { id: "duplicate", excludeFromPipeline: false },
        ],
      })
    ).toMatchObject({ ok: false, error: expect.stringContaining("Duplicate") });
    expect(
      parseLeadUpdateBatch({ updates: [{ id: "contact-1" }] })
    ).toMatchObject({ ok: false, error: expect.stringContaining("no changes") });
    expect(
      parseLeadUpdateBatch({
        updates: [{ id: "contact-1", excludeFromPipeline: "true" }],
      })
    ).toMatchObject({ ok: false, error: expect.stringContaining("boolean") });
    expect(
      parseLeadUpdateBatch({ updates: [{ id: "contact-1", tags: "partner" }] })
    ).toMatchObject({ ok: false, error: expect.stringContaining("array") });

    const statusCalls: unknown[][] = [];
    const result = await executeLeadUpdateBatch(
      [
        {
          id: "contact-1",
          status: "QUALIFIED",
          expectedCurrentStatus: "CONTACTED",
        },
        { id: "contact-2", status: "LOST" },
        { id: "missing", excludeFromPipeline: true },
      ],
      {
        loadContact: async (id: string) =>
          id === "missing" ? null : { tags: '["existing"]' },
        changeStatus: async (...args: unknown[]) => {
          statusCalls.push(args);
          return args[0] === "contact-2"
            ? { ok: false as const, reason: "conflict" as const }
            : { ok: true as const };
        },
        updateFields: async () => ({ ok: true as const }),
      }
    );

    expect(statusCalls).toEqual([
      ["contact-1", "QUALIFIED", "CONTACTED"],
      ["contact-2", "LOST", undefined],
    ]);
    expect(result).toEqual([
      { id: "contact-1", ok: true, applied: ["status"] },
      {
        id: "contact-2",
        ok: false,
        reason: "conflict",
        applied: [],
        message: "Status changed concurrently; no fields were updated",
      },
      {
        id: "missing",
        ok: false,
        reason: "not_found",
        applied: [],
        message: "Contact not found",
      },
    ]);
  });

  it("SC-5: refuses whitespace-padded mixed-case WON because only verified purchases may set it", async () => {
    const { parseLeadUpdateBatch } = await import("@/lib/leads/update");

    expect(
      parseLeadUpdateBatch({ updates: [{ id: "contact-1", status: "  wOn  " }] })
    ).toEqual({
      ok: false,
      error:
        "updates[0].status cannot be WON; WON is reserved for verified purchases via markLeadWonForPurchase",
    });
  });
});

describe("lead tag writes", () => {
  it("SC-7: tags add by default and require explicit remove or replace semantics", async () => {
    const { mergeLeadTags } = await import("@/lib/leads/tags");

    expect(
      mergeLeadTags('["existing","keep","existing",42]', [" keep ", "new", "new"])
    ).toEqual(["existing", "keep", "new"]);
    expect(mergeLeadTags("malformed", ["new"])).toEqual(["new"]);
    expect(mergeLeadTags(null, ["new"])).toEqual(["new"]);
    expect(mergeLeadTags('["existing","keep"]', ["existing"], "remove")).toEqual([
      "keep",
    ]);
    expect(mergeLeadTags('["existing","keep"]', ["replacement"], "replace")).toEqual([
      "replacement",
    ]);
  });
});
