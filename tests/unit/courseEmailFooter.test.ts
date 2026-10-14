import { describe, expect, it } from "bun:test";
import { brand } from "@/config/brand";
import {
  COURSE_EMAIL_FOOTER_LINK_TEXT,
  courseEmailFooterText,
  renderStepHtml,
  type DripMergeContext,
  type RenderableStep,
} from "@/lib/drip/template";
import type { TrackingSigner } from "@/lib/drip/tracking";

const baseContext: DripMergeContext = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  unsubscribeUrl: `${brand.urls.hub}/unsubscribe/course-token`,
  appUrl: brand.urls.hub,
  campaignSlug: "cohort-message",
};

const step: RenderableStep = {
  subject: "Course update",
  body: '<p>Details at <a href="{{app_url}}/dashboard">the dashboard</a>.</p>',
  ctaLabel: null,
  ctaUrl: null,
  order: 2,
};

describe("course email footer", () => {
  it("SC-14: exports the course footer copy and its action label", () => {
    expect(COURSE_EMAIL_FOOTER_LINK_TEXT).toBe("Stop course update emails");
    expect(courseEmailFooterText(" Agent Builders ")).toBe(
      `You're receiving this because you're enrolled in Agent Builders at ${brand.wordmark}.`
    );
    expect(courseEmailFooterText(null)).toBe(
      `You're receiving this because you're enrolled in your cohort at ${brand.wordmark}.`
    );
  });

  it("SC-14: renders course-specific copy, escapes the cohort name, and removes promotion", () => {
    const html = renderStepHtml(step, {
      ...baseContext,
      emailScope: "course",
      cohortTitle: " <b>X</b> ",
    });

    expect(html).toContain(
      `You're receiving this because you're enrolled in &lt;b&gt;X&lt;/b&gt; at ${brand.wordmark}.`
    );
    expect(html).toContain(
      `<a href="${baseContext.unsubscribeUrl}" style="color:#64748b;text-decoration:underline">${COURSE_EMAIL_FOOTER_LINK_TEXT}</a>`
    );
    expect(html).not.toContain(">Upcoming cohorts</a>");
    expect(html).not.toContain(">Unsubscribe</a>");
  });

  it("SC-14: leaves the default marketing footer byte-identical to explicit marketing scope", () => {
    const defaultHtml = renderStepHtml(step, baseContext);
    const marketingHtml = renderStepHtml(step, { ...baseContext, emailScope: "marketing" });

    expect(defaultHtml).toBe(marketingHtml);
    expect(defaultHtml).toContain(">Upcoming cohorts</a>");
    expect(defaultHtml).toContain(">Unsubscribe</a>");
  });

  it("SC-14: never UTM-tags or click-tracks the course unsubscribe URL", () => {
    const clicked: string[] = [];
    const tracking: TrackingSigner = {
      baseUrl: brand.urls.hub,
      openUrl: () => `${brand.urls.hub}/api/e/o/open-token`,
      clickUrl: (destination) => {
        clicked.push(destination);
        return `${brand.urls.hub}/api/e/c/${encodeURIComponent(destination)}`;
      },
    };

    const html = renderStepHtml(step, {
      ...baseContext,
      emailScope: "course",
      cohortTitle: "Agent Builders",
      tracking,
    });

    expect(html).toContain(`href="${baseContext.unsubscribeUrl}"`);
    expect(clicked).not.toContain(baseContext.unsubscribeUrl);
    expect(clicked.some((href) => href.includes("/dashboard"))).toBe(true);
  });
});
