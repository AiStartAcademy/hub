import { describe, expect, it } from "bun:test";
import { brand } from "@/config/brand";
import {
  parseGaClientId,
  deriveFbc,
  conversionIdsFromRequest,
  contextFromStripeMetadata,
} from "@/lib/serverConversions";

// A fake NextRequest-shaped object: only .cookies.get and .url are read.
function fakeReq(cookies: Record<string, string>, url = `${brand.urls.hub}/x`) {
  return {
    cookies: {
      get: (name: string) =>
        name in cookies ? { value: cookies[name] } : undefined,
    },
    url,
  };
}

describe("parseGaClientId", () => {
  it("extracts the client id from a real _ga cookie", () => {
    expect(parseGaClientId("GA1.1.1234567890.1700000000")).toBe("1234567890.1700000000");
  });

  it("handles the cross-subdomain form (GA1.2.x.y)", () => {
    expect(parseGaClientId("GA1.2.987654321.1699999999")).toBe("987654321.1699999999");
  });

  it("returns undefined for a missing or malformed cookie", () => {
    expect(parseGaClientId(undefined)).toBeUndefined();
    expect(parseGaClientId("")).toBeUndefined();
    expect(parseGaClientId("GA1.1.only-three")).toBeUndefined();
    // Non-numeric segments must not be passed to GA4 as a client id.
    expect(parseGaClientId("GA1.1.abc.def")).toBeUndefined();
  });
});

describe("deriveFbc", () => {
  it("builds Meta's documented fb.1.<time>.<fbclid> shape", () => {
    expect(deriveFbc("IwAR123abc", 1700000000000)).toBe("fb.1.1700000000000.IwAR123abc");
  });

  it("returns undefined when there is no fbclid", () => {
    expect(deriveFbc(undefined)).toBeUndefined();
    expect(deriveFbc("   ")).toBeUndefined();
  });
});

describe("conversionIdsFromRequest", () => {
  it("collects the GA client id and Meta cookies", () => {
    const ids = conversionIdsFromRequest(
      fakeReq({
        _ga: "GA1.1.1234567890.1700000000",
        _fbp: "fb.1.1700000000000.987654321",
        _fbc: "fb.1.1700000000000.IwARexisting",
      })
    );
    expect(ids).toEqual({
      gaCid: "1234567890.1700000000",
      fbp: "fb.1.1700000000000.987654321",
      fbc: "fb.1.1700000000000.IwARexisting",
    });
  });

  it("falls back to deriving fbc from the fbclid param when the pixel never set the cookie", () => {
    const ids = conversionIdsFromRequest(
      fakeReq({ _ga: "GA1.1.1.2" }, `${brand.urls.hub}/x?fbclid=IwARblocked`)
    );
    expect(ids.fbc).toMatch(/^fb\.1\.\d+\.IwARblocked$/);
  });

  it("omits keys entirely when no identifiers exist, rather than sending empty strings", () => {
    // Stripe rejects metadata values that are not strings; empty keys would also
    // create a useless, unmatched Meta event.
    expect(conversionIdsFromRequest(fakeReq({}))).toEqual({});
  });
});

describe("contextFromStripeMetadata", () => {
  it("rehydrates the ad identifiers stashed at checkout creation", () => {
    const ctx = contextFromStripeMetadata(
      { gaCid: "111.222", fbp: "fb.1.1.2", fbc: "fb.1.1.3", cohortId: "c1" },
      { email: "Buyer@Example.com " }
    );
    expect(ctx.gaClientId).toBe("111.222");
    expect(ctx.fbp).toBe("fb.1.1.2");
    expect(ctx.fbc).toBe("fb.1.1.3");
    expect(ctx.email).toBe("Buyer@Example.com ");
    // No request envelope in a webhook — these must stay absent so Meta does not
    // match the sale against the server's own IP/user agent.
    expect(ctx.clientIp).toBeUndefined();
    expect(ctx.userAgent).toBeUndefined();
  });

  it("survives a session with no metadata at all", () => {
    expect(contextFromStripeMetadata(null)).toEqual({});
    expect(contextFromStripeMetadata(undefined, { email: "a@b.co" })).toEqual({
      email: "a@b.co",
    });
  });
});
