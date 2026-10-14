import { describe, expect, it } from "bun:test";
import { brand } from "@/config/brand";
import {
  isSupportedCtaUrlMergeField,
  renderMergeFields,
  renderStepHtml,
  renderSubject,
  type DripMergeContext,
  type RenderableStep,
} from "@/lib/drip/template";

const ctx: DripMergeContext = {
  name: brand.signer.name,
  email: "lex@example.com",
  unsubscribeUrl: `${brand.urls.hub}/unsubscribe/token-123`,
  appUrl: brand.urls.hub,
  campaignSlug: "agency-launch-nurture",
};

const signerFirstName = brand.signer.name.split(/\s+/)[0];

function step(overrides: Partial<RenderableStep> = {}): RenderableStep {
  return {
    subject: "Hello {{first_name}}",
    body: "<p>Hello {{first_name}}</p>",
    ctaLabel: "Open the app",
    ctaUrl: "{{app_url}}/dashboard",
    order: 1,
    ...overrides,
  };
}

function utmParams(href: string): URLSearchParams {
  return new URL(href).searchParams;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("renderMergeFields", () => {
  it("substitutes the supported tokens case-insensitively and tolerates inner spaces", () => {
    expect(
      renderMergeFields(
        [
          "{{ FIRST_NAME }}",
          "{{ name }}",
          "{{EMAIL}}",
          "{{ unsubscribe_url }}",
          "{{ APP_URL }}",
          "{{ cohorts_url }}",
        ].join(" | "),
        ctx
      )
    ).toBe(
      [
        signerFirstName,
        brand.signer.name,
        "lex@example.com",
        `${brand.urls.hub}/unsubscribe/token-123`,
        brand.urls.hub,
        `${brand.urls.hub}/cohorts`,
      ].join(" | ")
    );
  });

  it("strips unknown tokens so no literal braces survive", () => {
    const rendered = renderMergeFields("Hi {{first_name}} {{unknown_token}} {{missing}}", ctx);
    expect(rendered).toBe(`Hi ${signerFirstName}  `);
    expect(rendered).not.toContain("{{");
    expect(rendered).not.toContain("}}");
  });

  it("renders cohort merge fields as trusted HTML while still escaping contact fields", () => {
    const rendered = renderMergeFields(
      "{{upcoming_cohorts}} | {{next_cohort}} | {{name}}",
      {
        ...ctx,
        name: "<script>alert(1)</script>",
        upcomingCohortsHtml:
          `<div><a href="${brand.urls.hub}/cohorts">Upcoming cohorts</a></div>`,
        nextCohortLine: "Next cohort: <strong>AI Start</strong>, Sep 10, 2026 · $500",
      }
    );

    expect(rendered).toContain(`<a href="${brand.urls.hub}/cohorts">`);
    expect(rendered).toContain("<strong>AI Start</strong>");
    expect(rendered).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(rendered).not.toContain("<script>alert(1)</script>");
  });

  it("treats missing cohort fields like any other undefined merge value", () => {
    const rendered = renderMergeFields(
      "Hi {{first_name}} {{upcoming_cohorts}} {{next_cohort}} {{missing}}",
      ctx
    );

    expect(rendered).toBe(`Hi ${signerFirstName}   `);
    expect(rendered).not.toContain("{{");
    expect(rendered).not.toContain("}}");
  });

  it("falls back to there for Lead placeholders and empty names", () => {
    expect(
      renderMergeFields("Hi {{first_name}}", { ...ctx, name: "Lead" })
    ).toBe("Hi there");
    expect(
      renderMergeFields("Hi {{first_name}}", { ...ctx, name: "LEAD Example" })
    ).toBe("Hi there");
    expect(
      renderMergeFields("Hi {{first_name}}", { ...ctx, name: "   " })
    ).toBe("Hi there");
  });

  it("renders certificate_* and linkedin_add_url tokens, escaped, with safe fallbacks when absent", () => {
    const certificateUrl = `${brand.urls.hub}/verify?id=cert-%3C123%3E%26%22`;
    const certificatePdfUrl = `${brand.urls.hub}/api/certificates/cert-%3C123%3E%26%22/download?format=pdf`;
    const certificatePngUrl = `${brand.urls.hub}/api/certificates/cert-%3C123%3E%26%22/download?format=png`;
    const linkedinAddUrl =
      `https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=AI%20Agents&organizationName=${encodeURIComponent(brand.name)}&issueYear=&issueMonth=&certId=cert-%3C123%3E%26%22&certUrl=${encodeURIComponent(certificateUrl)}`;
    const certificateContext: DripMergeContext = {
      ...ctx,
      certificateId: 'cert-<123>&"',
      certificateUrl,
      certificatePdfUrl,
      certificatePngUrl,
      linkedinAddUrl,
    };

    expect(
      renderMergeFields(
        "{{certificate_id}} | {{certificate_url}} | {{certificate_pdf_url}} | {{certificate_png_url}} | {{linkedin_add_url}}",
        certificateContext
      )
    ).toBe(
      `cert-&lt;123&gt;&amp;&quot; | ${certificateUrl} | ${certificatePdfUrl} | ${certificatePngUrl} | ${linkedinAddUrl}`
    );

    expect(
      renderMergeFields(
        "{{certificate_id}} | {{certificate_url}} | {{certificate_pdf_url}} | {{certificate_png_url}} | {{linkedin_add_url}}",
        ctx
      )
    ).toBe(` | ${brand.urls.hub}/settings |  |  | `);
  });

  it("certificate url tokens are accepted as CTA URLs", () => {
    expect(isSupportedCtaUrlMergeField("certificate_url")).toBe(true);
    expect(isSupportedCtaUrlMergeField("certificate_pdf_url")).toBe(true);
    expect(isSupportedCtaUrlMergeField("certificate_png_url")).toBe(true);
    expect(isSupportedCtaUrlMergeField("linkedin_add_url")).toBe(true);
  });
});

// Cart-recovery copy is shared by every abandoner, but the commerce context is
// per-contact and can be missing (the Payment row aged out, or the lookup
// failed). The fallbacks are what keep that copy grammatical either way.
describe("renderMergeFields — cart recovery commerce fields", () => {
  const abandoned: DripMergeContext = {
    ...ctx,
    abandonedItemTitle: "10-Day Intensive (Aug 17)",
    abandonedAmount: "$150.00",
    resumeCheckoutUrl: "https://checkout.stripe.com/c/pay/cs_test_recovery",
  };

  it("names the exact cohort, price and resume link when they are known", () => {
    expect(
      renderMergeFields(
        "Your seat in {{abandoned_item_title}} — {{abandoned_amount}}: {{resume_checkout_url}}",
        abandoned
      )
    ).toBe(
      "Your seat in 10-Day Intensive (Aug 17) — $150.00: https://checkout.stripe.com/c/pay/cs_test_recovery"
    );
  });

  it("falls back to copy that still reads correctly with no commerce context", () => {
    // "your cohort" keeps the sentence grammatical; the amount collapses to
    // nothing rather than printing "$0.00" or a bare token; the link degrades
    // to the cohorts page rather than a dead href.
    expect(renderMergeFields("Your seat in {{abandoned_item_title}}", ctx)).toBe(
      "Your seat in your cohort"
    );
    expect(renderMergeFields("{{abandoned_amount}}", ctx)).toBe("");
    expect(renderMergeFields("{{resume_checkout_url}}", ctx)).toBe(
      `${brand.urls.hub}/cohorts`
    );
  });

  it("escapes a cohort title so a stray character cannot break the markup", () => {
    expect(
      renderMergeFields("{{abandoned_item_title}}", {
        ...ctx,
        abandonedItemTitle: 'Bootcamp <script>"x"</script>',
      })
    ).not.toContain("<script>");
  });
});

describe("renderStepHtml", () => {
  it("escapes contact names in the HTML body so injected script tags do not appear", () => {
    const html = renderStepHtml(
      step({ body: "<p>Hello {{name}}</p>" }),
      { ...ctx, name: "<script>alert(1)</script>" }
    );

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
  });

  it("always includes the unsubscribe URL, even with an empty body and no CTA", () => {
    const html = renderStepHtml(
      step({
        body: "",
        ctaLabel: null,
        ctaUrl: null,
      }),
      ctx
    );

    expect(html).toContain(ctx.unsubscribeUrl);
    expect(html).toContain("Unsubscribe");
  });

  it("renders no CTA button when only one CTA half is present", () => {
    const labelOnly = renderStepHtml(
      step({
        ctaLabel: "Open the app",
        ctaUrl: null,
      }),
      ctx
    );
    const urlOnly = renderStepHtml(
      step({
        ctaLabel: null,
        ctaUrl: "https://example.com/cta-only",
      }),
      ctx
    );

    expect(labelOnly).not.toContain("Open the app");
    expect(urlOnly).not.toContain("https://example.com/cta-only");
  });
});

describe("renderSubject", () => {
  it("keeps merge output readable as plain text rather than HTML-escaped entities", () => {
    // Subject is a plain-text header; the HTML escaping that matters is in renderStepHtml().
    const subject = renderSubject(
      step({ subject: "Hello {{name}}" }),
      { ...ctx, name: "<script>alert(1)</script>" }
    );

    expect(subject).toBe("Hello <script>alert(1)</script>");
    expect(subject).not.toContain("&lt;");
    expect(subject).not.toContain("&gt;");
  });

  it("strips HTML tags from cohort merge fields in subjects", () => {
    const subject = renderSubject(
      step({
        subject: "{{next_cohort}} | {{upcoming_cohorts}}",
      }),
      {
        ...ctx,
        upcomingCohortsHtml:
          `<div><a href="${brand.urls.hub}/cohorts">Upcoming cohorts</a></div>`,
        nextCohortLine: "Next cohort: <strong>AI Start</strong>, Sep 10, 2026 · $500",
      }
    );

    expect(subject).toContain("Next cohort: AI Start");
    expect(subject).toContain("Sep 10, 2026 · $500");
    expect(subject).toContain("Upcoming cohorts");
    expect(subject).not.toMatch(/<[^>]+>/);
  });
});

describe("renderStepHtml — UTM tagging", () => {
  it("tags the CTA button with source/medium/campaign and a step+cta content value", () => {
    const html = renderStepHtml(
      step({ ctaLabel: "Book now", ctaUrl: `${brand.urls.hub}/cohorts`, order: 3 }),
      ctx
    );
    // The CTA <a> is the only tag whose text is "Book now" — anchor the match
    // on that rather than on "/cohorts" so it can't accidentally grab the
    // footer's separate "Upcoming cohorts" link, which also points at /cohorts.
    const ctaHref = html.match(/href="([^"]+)"[^>]*>\s*Book now/)![1];
    const params = utmParams(ctaHref);
    expect(params.get("utm_source")).toBe("email");
    expect(params.get("utm_medium")).toBe("drip");
    expect(params.get("utm_campaign")).toBe("agency-launch-nurture");
    expect(params.get("utm_content")).toBe("step3-cta");
  });

  it("tags authored body links with a derived, step-prefixed content value", () => {
    const html = renderStepHtml(
      step({
        body: '<a href="{{app_url}}/courses">Courses</a> <a href="{{app_url}}/assets">Assets</a>',
        ctaLabel: null,
        ctaUrl: null,
        order: 1,
      }),
      ctx
    );
    const courses = utmParams(html.match(new RegExp(`href="(${escapeRegExp(brand.urls.hub)}/courses[^"]*)"`))![1]);
    const assets = utmParams(html.match(new RegExp(`href="(${escapeRegExp(brand.urls.hub)}/assets[^"]*)"`))![1]);
    expect(courses.get("utm_content")).toBe("step1-courses");
    expect(assets.get("utm_content")).toBe("step1-assets");
  });

  it("tags the footer 'Upcoming cohorts' link", () => {
    const html = renderStepHtml(step({ ctaLabel: null, ctaUrl: null }), ctx);
    const footerHref = html.match(new RegExp(`href="(${escapeRegExp(brand.urls.hub)}/cohorts\\?[^"]*)"`));
    expect(footerHref).not.toBeNull();
    expect(utmParams(footerHref![1]).get("utm_source")).toBe("email");
  });

  it("never tags mailto: links", () => {
    const html = renderStepHtml(
      step({
        body: `<a href="mailto:${brand.email.contact}">Email us</a>`,
        ctaLabel: null,
        ctaUrl: null,
      }),
      ctx
    );
    expect(html).toContain(`href="mailto:${brand.email.contact}"`);
  });

  it("never tags the unsubscribe link", () => {
    const html = renderStepHtml(step({ ctaLabel: null, ctaUrl: null }), ctx);
    expect(html).toContain(`href="${ctx.unsubscribeUrl}"`);
  });

  it("does not double-tag a cohort-block link the caller already tagged", () => {
    const preTagged =
      `<a href="${brand.urls.hub}/cohorts/abc123?utm_source=email&utm_medium=drip&utm_campaign=agency-launch-nurture&utm_content=step2-cohort-abc123">10-Day Intensive</a>`;
    const html = renderStepHtml(
      step({ body: "{{upcoming_cohorts}}", ctaLabel: null, ctaUrl: null, order: 2 }),
      { ...ctx, upcomingCohortsHtml: preTagged }
    );
    // The pre-tagged content value appears exactly once — a double-tag would
    // append a SECOND "utm_source=email&…" onto the same href (still one
    // occurrence of the original content value, but a garbled query string),
    // or the retag would overwrite it. Either way this substring survives
    // intact only if the pass truly no-op'd on it. The footer's own separate
    // "Upcoming cohorts" link also carries utm_source=email, so this asserts
    // on the specific cohort content value, not a global count.
    const matches = [...html.matchAll(/utm_content=step2-cohort-abc123/g)];
    expect(matches).toHaveLength(1);
    expect(html).not.toContain("utm_source=email&utm_source=email");
  });

  it("gives the same link a different content value on a different step", () => {
    const stepOne = renderStepHtml(step({ body: '<a href="{{app_url}}/assets">Assets</a>', order: 1 }), ctx);
    const stepFive = renderStepHtml(step({ body: '<a href="{{app_url}}/assets">Assets</a>', order: 5 }), ctx);
    expect(stepOne.match(/href="([^"]*assets[^"]*)"/)![1]).toContain("utm_content=step1-assets");
    expect(stepFive.match(/href="([^"]*assets[^"]*)"/)![1]).toContain("utm_content=step5-assets");
  });
});

describe("client-safe merge field tokens", () => {
  it("SC5.5: MERGE_FIELD_TOKENS lives in a module with no mail/server imports and matches the renderer's field table", async () => {
    const tokens = await import("@/lib/drip/mergeFieldTokens");
    const template = await import("@/lib/drip/template");
    const source = await Bun.file(new URL("../../src/lib/drip/mergeFieldTokens.ts", import.meta.url)).text();
    expect(source.split("\n").filter((line) => line.startsWith("import "))).toEqual([]);
    expect([...tokens.MERGE_FIELD_TOKENS].sort()).toEqual([...template.MERGE_FIELD_TOKENS].sort());
    expect(tokens.MERGE_FIELD_PATTERN.source).toBe(template.MERGE_FIELD_PATTERN.source);
  });
});
