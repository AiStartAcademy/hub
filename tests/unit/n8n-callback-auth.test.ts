import { afterEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/n8n/callback/route";

const ORIGINAL_SECRET = process.env.N8N_CALLBACK_SECRET;

describe("n8n callback authentication", () => {
  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.N8N_CALLBACK_SECRET;
    else process.env.N8N_CALLBACK_SECRET = ORIGINAL_SECRET;
  });

  it("fails closed before handling the body when the callback secret is unset", async () => {
    delete process.env.N8N_CALLBACK_SECRET;
    const request = new NextRequest("https://hub.test/api/n8n/callback", {
      method: "POST",
      body: "not-json",
    });

    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "n8n callback not configured" });
  });

  it("allows the configured secret through to body validation", async () => {
    process.env.N8N_CALLBACK_SECRET = "configured-secret";
    const request = new NextRequest("https://hub.test/api/n8n/callback", {
      method: "POST",
      headers: { authorization: "Bearer configured-secret" },
      body: "not-json",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON" });
  });
});
