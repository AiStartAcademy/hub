import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

import { sanitizeEmailHtml } from "@/lib/outreach/sanitizeHtml";
import { textToEmailHtml } from "@/lib/outreach/textToEmailHtml";

const contact = {
  id: "contact-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  unsubscribedAt: null,
  unsubscribeToken: "unsubscribe-token",
};

const findUnique = mock(async () => contact);
const createEvent = mock(async () => ({ id: "event-1" }));
const updateEvent = mock(async () => ({ id: "event-1" }));
const updateContact = mock(async () => contact);
const sendMail = mock(async () => undefined);
/** Shaped as `getUpcomingCohorts` selects it, so the real renderer runs. */
const cohortRows = [
  {
    id: "cohort-1",
    slug: "ai-foundations",
    title: "AI Foundations",
    startDate: new Date("2027-03-01T00:00:00Z"),
    endDate: new Date("2027-03-12T00:00:00Z"),
    startTime: "10:00",
    endTime: "17:00",
    timezone: "America/Los_Angeles",
    groups: [{ id: "g1", name: "In Person", price: 500, inPerson: true, seats: 20 }],
  },
];

// Only `@/lib/prisma` and `@/lib/mail` are mocked. Mocking @/lib/drip/{engine,
// cohorts,tracking} would replace them for drip-from / drip-cohorts /
// drip-tracking too, which assert the real implementations. Those modules run
// for real here against the prisma mock, which also makes SC5.4's
// preview-equals-sent claim a property of the real pipeline rather than of a
// stub.
process.env.NEXT_PUBLIC_APP_URL = "https://hub.example.com";
// `trackingSecret()` falls back to process.env, so a developer machine with a
// real secret would otherwise make the send inject an open pixel that the
// preview (which deliberately mints no tracking tokens) cannot have. Pin the
// untracked case so SC5.4 compares the pipeline, not the environment.
process.env.DRIP_TRACKING_SECRET = "";

const realMail = await import("@/lib/mail");

mock.module("@/lib/prisma", () => ({
  default: {
    contact: { findUnique, update: updateContact },
    emailEvent: { create: createEvent, update: updateEvent },
    // resolveDripFrom / createTrackingSigner read the Integrations store; an
    // empty store is the untracked-and-default-sender path this file wants.
    secret: { findUnique: async () => null, findMany: async () => [] },
    cohort: { findMany: async () => cohortRows },
  },
}));
mock.module("@/lib/mail", () => ({ ...realMail, sendMail }));

const { previewOneOffEmail, sendOneOffEmail } = await import("@/lib/outreach/email");

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  findUnique.mockClear();
  createEvent.mockClear();
  updateEvent.mockClear();
  updateContact.mockClear();
  sendMail.mockClear();

});

describe("one-off outreach email rendering", () => {
  it("SC5.1: converts escaped plain text, line breaks, and bare URLs to sanitizer-canonical HTML", () => {
    const text = 'Hello & <team> "today"\r\nsee https://x.com/a.\r\n\r\nHTTP only: http://example.com/path?q=1, and mail@example.com';
    const html = textToEmailHtml(text);

    expect(html).toBe(
      '<p>Hello &amp; &lt;team&gt; "today"<br />see <a href="https://x.com/a" rel="noopener noreferrer">https://x.com/a</a>.</p>' +
        '<p>HTTP only: <a href="http://example.com/path?q=1" rel="noopener noreferrer">http://example.com/path?q=1</a>, and mail@example.com</p>'
    );
    expect(sanitizeEmailHtml(html)).toBe(html);
    expect(textToEmailHtml(" \r\n\t ")).toBe("");
    expect(textToEmailHtml("Hi {{first_name}}")).toBe("<p>Hi {{first_name}}</p>");
  });

  it("SC5.2: renders cohort and first-name merge fields in the one-off context", async () => {
    const result = await previewOneOffEmail({
      contactId: contact.id,
      subject: "Hello {{first_name}}",
      body: "{{upcoming_cohorts}}",
      mode: "html",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subject).toContain("Ada");
    // Real cohort renderer output: the cohort title, its deep link, and the
    // one-off UTM campaign that proves the context was wired, not defaulted.
    expect(result.html).toContain("AI Foundations");
    expect(result.html).toContain("https://hub.example.com/cohorts/ai-foundations");
    expect(result.html).toContain("utm_campaign=outreach-oneoff");
  });

  it("SC5.3: strips unknown tokens and never click-wraps the unsubscribe URL", async () => {
    const result = await previewOneOffEmail({
      contactId: contact.id,
      subject: "Known {{first_name}} unknown {{not_a_token}}",
      body: '<p>{{unsubscribe_url}} {{also_unknown}}</p>',
      mode: "html",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subject).not.toContain("{{");
    expect(result.html).not.toContain("{{");
    expect(result.html).toContain("https://hub.example.com/unsubscribe?token=unsubscribe-token");
    expect(result.html).not.toContain("/api/drip/click");
  });

  it("SC5.4: preview HTML equals the HTML handed to sendMail for identical content", async () => {
    const input = {
      contactId: contact.id,
      subject: "Hello {{first_name}}",
      body: "First line\nsecond line",
      mode: "plain" as const,
    };
    const preview = await previewOneOffEmail(input);

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const sent = await sendOneOffEmail({
      contactId: input.contactId,
      subject: input.subject,
      html: input.body,
      mode: input.mode,
      staffId: "staff-1",
    });

    expect(sent.ok).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
    // The ONLY sanctioned divergence between preview and send is the tracking
    // signer (pinned off above) and the persistence/SMTP side effects.
    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      subject: preview.subject,
      html: preview.html,
    });
  });
});
