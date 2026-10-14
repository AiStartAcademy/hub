import { describe, expect, it } from "bun:test";
import { brand } from "@/config/brand";
import { appendUtmParams, deriveLinkContent, tagLinksInHtml } from "@/lib/drip/link-utm";

describe("appendUtmParams", () => {
  it("appends all four params to a bare absolute URL", () => {
    const url = appendUtmParams(`${brand.urls.hub}/cohorts`, {
      campaign: "agency-launch-nurture",
      content: "step1-cta",
    });
    const params = new URL(url).searchParams;
    expect(params.get("utm_source")).toBe("email");
    expect(params.get("utm_medium")).toBe("drip");
    expect(params.get("utm_campaign")).toBe("agency-launch-nurture");
    expect(params.get("utm_content")).toBe("step1-cta");
  });

  it("inserts the query string before a fragment, not after", () => {
    const url = appendUtmParams(`${brand.urls.hub}/cohorts#membership`, {
      campaign: "agency-launch-nurture",
      content: "step1-membership",
    });
    expect(url.indexOf("#membership")).toBe(url.length - "#membership".length);
    expect(url).toStartWith(`${brand.urls.hub}/cohorts?`);
  });

  it("appends onto an existing query string rather than replacing it", () => {
    const url = appendUtmParams(`${brand.urls.hub}/cohorts?ref=partner`, {
      campaign: "agency-launch-nurture",
      content: "step1-cta",
    });
    const params = new URL(url).searchParams;
    expect(params.get("ref")).toBe("partner");
    expect(params.get("utm_campaign")).toBe("agency-launch-nurture");
  });

  it("is idempotent — a URL that already has utm_source is returned unchanged", () => {
    const alreadyTagged =
      `${brand.urls.hub}/cohorts?utm_source=email&utm_medium=drip&utm_campaign=x&utm_content=y`;
    expect(appendUtmParams(alreadyTagged, { campaign: "different", content: "different" })).toBe(
      alreadyTagged
    );
  });

  it("works on a site-relative URL", () => {
    const url = appendUtmParams("/cohorts", { campaign: "agency-launch-nurture", content: "step1-cta" });
    expect(url).toStartWith("/cohorts?utm_source=email");
  });

  it("URL-encodes campaign and content values", () => {
    const url = appendUtmParams(`${brand.urls.hub}/cohorts`, {
      campaign: "a b",
      content: "c&d",
    });
    const params = new URL(url).searchParams;
    expect(params.get("utm_campaign")).toBe("a b");
    expect(params.get("utm_content")).toBe("c&d");
  });
});

describe("deriveLinkContent", () => {
  it.each([
    [`${brand.urls.hub}/courses`, "courses"],
    [`${brand.urls.hub}/assets`, "assets"],
    [`${brand.urls.hub}/cohorts`, "cohorts"],
    [`${brand.urls.hub}/cohorts#membership`, "membership"],
    [`${brand.urls.hub}/cohorts/abc123`, "cohort-abc123"],
    [`${brand.urls.hub}/cohorts/ten-day-intensive`, "cohort-ten-day-intensive"],
    ["/courses", "courses"],
    [`${brand.urls.hub}/`, "link"],
  ])("derives %s -> %s", (url, expected) => {
    expect(deriveLinkContent(url)).toBe(expected);
  });
});

describe("tagLinksInHtml", () => {
  const opts = { campaign: "agency-launch-nurture", stepOrder: 3, unsubscribeUrl: `${brand.urls.hub}/u/tok` };

  it("tags http(s) links and leaves mailto: untouched", () => {
    const html = tagLinksInHtml(
      `<a href="${brand.urls.hub}/courses">Courses</a> <a href="mailto:${brand.email.contact}">Email</a>`,
      opts
    );
    expect(html).toContain(`href="mailto:${brand.email.contact}"`);
    expect(html.match(/href="([^"]*courses[^"]*)"/)![1]).toContain("utm_content=step3-courses");
  });

  it("never tags the unsubscribe link", () => {
    const html = tagLinksInHtml(`<a href="${opts.unsubscribeUrl}">Unsubscribe</a>`, opts);
    expect(html).toBe(`<a href="${opts.unsubscribeUrl}">Unsubscribe</a>`);
  });

  it("leaves an already-tagged link alone (idempotent)", () => {
    const tagged =
      `<a href="${brand.urls.hub}/cohorts?utm_source=email&utm_medium=drip&utm_campaign=x&utm_content=y">Go</a>`;
    expect(tagLinksInHtml(tagged, opts)).toBe(tagged);
  });
});
