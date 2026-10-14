import { afterEach, describe, expect, it } from "bun:test";
import { fbqTrack, shouldLoadMetaPixel } from "@/lib/metaPixel";

const originalWindow = globalThis.window;

function installWindow(consent: string | null, calls: unknown[][]): void {
  globalThis.window = {
    localStorage: {
      getItem: () => consent,
    },
    fbq: (...args: unknown[]) => calls.push(args),
  } as unknown as Window & typeof globalThis;
}

describe("Meta Pixel consent", () => {
  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it("loads only for explicitly granted marketing consent", () => {
    expect(shouldLoadMetaPixel("granted")).toBe(true);
    expect(shouldLoadMetaPixel("denied")).toBe(false);
    expect(shouldLoadMetaPixel("unset")).toBe(false);
  });

  it("becomes eligible when a visitor grants consent later", () => {
    expect(shouldLoadMetaPixel("denied")).toBe(false);
    expect(shouldLoadMetaPixel("granted")).toBe(true);
  });

  it("withholds fbq events until consent is granted", () => {
    const calls: unknown[][] = [];
    installWindow("declined", calls);
    fbqTrack("Lead", { content_name: "quiz" }, "response-1");
    installWindow(null, calls);
    fbqTrack("Purchase", { value: 100 }, "session-1");
    expect(calls).toEqual([]);

    installWindow("accepted", calls);
    fbqTrack("Lead", { content_name: "quiz" }, "response-2");
    expect(calls).toEqual([
      ["track", "Lead", { content_name: "quiz" }, { eventID: "response-2" }],
    ]);
  });
});
