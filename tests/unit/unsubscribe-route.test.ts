import { beforeEach, describe, expect, it, mock } from "bun:test";

type UnsubscribeResult =
  | { ok: true; email: string; alreadyDone: boolean }
  | { ok: false };

const calls: string[] = [];
const unsubscribeByToken = mock(async (
  token: string,
  _scope: "course" | "marketing" = "marketing"
): Promise<UnsubscribeResult> => {
  calls.push(token);
  if (token === "known") return { ok: true, email: "ada@example.com", alreadyDone: false };
  if (token === "already") return { ok: true, email: "ada@example.com", alreadyDone: true };
  return { ok: false };
});

// mock.module is process-wide in bun. This file stubs the whole drip engine, so
// it must stay alphabetically last among the tests that import it (drip-*.test.ts,
// outreach-email.test.ts) — "unsubscribe-route" already sorts after all of them.
mock.module("@/lib/drip/engine", () => ({ unsubscribeByToken }));

const { POST, GET, dynamic } = await import("@/app/api/unsubscribe/route");

beforeEach(() => {
  calls.length = 0;
  unsubscribeByToken.mockClear();
});

describe("POST /api/unsubscribe (RFC 8058 one-click)", () => {
  it("SC4.1: accepts the token from the query string", async () => {
    const response = await POST(
      new Request("https://hub.example.com/api/unsubscribe?token=known", { method: "POST" })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(calls).toEqual(["known"]);
  });

  it("SC4.2: accepts a form-encoded body (what mail clients actually POST)", async () => {
    const response = await POST(
      new Request("https://hub.example.com/api/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click&token=known",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(calls).toEqual(["known"]);
  });

  it("SC4.3: accepts a JSON body", async () => {
    const response = await POST(
      new Request("https://hub.example.com/api/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "known" }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("SC4.4: is idempotent — an already-unsubscribed token still returns 200", async () => {
    const response = await POST(
      new Request("https://hub.example.com/api/unsubscribe?token=already", { method: "POST" })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("SC4.5: returns 404 for an unknown token", async () => {
    const response = await POST(
      new Request("https://hub.example.com/api/unsubscribe?token=nope", { method: "POST" })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false });
  });

  it("SC4.6: returns 404 for a missing token without hitting the engine", async () => {
    const response = await POST(
      new Request("https://hub.example.com/api/unsubscribe", { method: "POST" })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false });
    expect(unsubscribeByToken).not.toHaveBeenCalled();
  });

  it("SC4.7: tolerates a malformed JSON body", async () => {
    const response = await POST(
      new Request("https://hub.example.com/api/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      })
    );

    expect(response.status).toBe(404);
  });

  it("SC-14: passes the course scope from the query string", async () => {
    const response = await POST(
      new Request(
        "https://hub.example.com/api/unsubscribe?token=known&scope=course",
        { method: "POST" }
      )
    );

    expect(response.status).toBe(200);
    expect(unsubscribeByToken).toHaveBeenCalledWith("known", "course");
    expect(calls).toEqual(["known"]);
  });

  it("SC-14: treats an unknown scope as marketing", async () => {
    const response = await POST(
      new Request(
        "https://hub.example.com/api/unsubscribe?token=known&scope=bogus",
        { method: "POST" }
      )
    );

    expect(response.status).toBe(200);
    expect(unsubscribeByToken).toHaveBeenCalledWith("known", "marketing");
  });
});

describe("GET /api/unsubscribe", () => {
  it("SC4.8: 302-redirects to the click-through confirmation page", async () => {
    // `a%2Bb` in the query string is the token `a+b`; it must be re-encoded on
    // the way out, not passed through raw (where `+` would decode as a space).
    const response = await GET(
      new Request("https://hub.example.com/api/unsubscribe?token=a%2Bb", { method: "GET" })
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/unsubscribe?token=a%2Bb");
    expect(unsubscribeByToken).not.toHaveBeenCalled();
  });

  it("SC4.9: redirects with an empty token rather than erroring", async () => {
    const response = await GET(
      new Request("https://hub.example.com/api/unsubscribe", { method: "GET" })
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/unsubscribe?token=");
  });

  it("SC-14: preserves the course scope in the confirmation redirect", async () => {
    const response = await GET(
      new Request(
        "https://hub.example.com/api/unsubscribe?token=known&scope=course",
        { method: "GET" }
      )
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/unsubscribe?token=known&scope=course"
    );
  });
});

describe("route config", () => {
  it("SC4.10: is force-dynamic so the token is never cached", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
