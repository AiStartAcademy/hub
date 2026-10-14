import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { requireServiceToken } from "@/lib/serviceAuth";

const ENV = "TEST_SERVICE_TOKEN";

function reqWithAuth(header?: string): Request {
  return new Request("https://hub.test/api", {
    headers: header ? { authorization: header } : {},
  });
}

describe("requireServiceToken", () => {
  const original = process.env[ENV];

  beforeEach(() => {
    process.env[ENV] = "secret123";
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  it("returns null (allows) when the bearer token matches", () => {
    expect(requireServiceToken(reqWithAuth("Bearer secret123"), ENV)).toBeNull();
  });

  it("401s when the token is wrong", async () => {
    const res = requireServiceToken(reqWithAuth("Bearer nope"), ENV);
    expect(res?.status).toBe(401);
  });

  it("401s for a wrong token with the same length", () => {
    const res = requireServiceToken(reqWithAuth("Bearer secret124"), ENV);
    expect(res?.status).toBe(401);
  });

  it("401s when the Authorization header is missing", () => {
    const res = requireServiceToken(reqWithAuth(), ENV);
    expect(res?.status).toBe(401);
  });

  it("401s when the header lacks the 'Bearer ' scheme", () => {
    const res = requireServiceToken(reqWithAuth("secret123"), ENV);
    expect(res?.status).toBe(401);
  });

  it("500s (fails closed) when the server env token is not set", () => {
    delete process.env[ENV];
    const res = requireServiceToken(reqWithAuth("Bearer secret123"), ENV);
    expect(res?.status).toBe(500);
  });
});
