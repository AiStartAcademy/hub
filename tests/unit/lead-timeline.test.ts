import { describe, expect, it, mock, beforeEach } from "bun:test";

// getLeadTimeline merges six independently-ordered sources. Mock at the prisma
// boundary so the merge, cursor and mapping logic are exercised for real.
type Row = Record<string, unknown>;

const data: {
  emailEvent: Row[];
  contactEvent: Row[];
  dripEnrollment: Row[];
  contactNote: Row[];
  contactCall: Row[];
  contactMessage: Row[];
  leadBooking: Row[];
  payment: Row[];
  membership: Row[];
} = {
  emailEvent: [],
  contactEvent: [],
  dripEnrollment: [],
  contactNote: [],
  contactCall: [],
  contactMessage: [],
  leadBooking: [],
  payment: [],
  membership: [],
};

/** The contact whose email keys the money sources. */
let contactRow: Row | null = { email: "lead@example.com" };

const lastArgs: Record<string, Row> = {};

function model(key: keyof typeof data, dateField: string) {
  return {
    findMany: async (args: Row) => {
      lastArgs[key] = args;
      const where = (args.where ?? {}) as Row;
      const range = where[dateField] as { lt?: Date } | undefined;
      let rows = data[key];
      if (range?.lt) rows = rows.filter((r) => (r[dateField] as Date) < range.lt!);
      const take = (args.take as number) ?? rows.length;
      return rows
        .slice()
        .sort((a, b) => (b[dateField] as Date).getTime() - (a[dateField] as Date).getTime())
        .slice(0, take);
    },
  };
}

mock.module("@/lib/prisma", () => ({
  default: {
    contact: { findUnique: async () => contactRow },
    emailEvent: model("emailEvent", "createdAt"),
    contactEvent: model("contactEvent", "createdAt"),
    dripEnrollment: model("dripEnrollment", "enrolledAt"),
    contactNote: model("contactNote", "createdAt"),
    contactCall: model("contactCall", "createdAt"),
    contactMessage: model("contactMessage", "createdAt"),
    leadBooking: model("leadBooking", "updatedAt"),
    // Payment/Membership are queried by buyerEmail and are not cursor-filtered
    // in SQL (their two dated moments are filtered in code), so the mock
    // deliberately does not apply a date range.
    payment: model("payment", "createdAt"),
    membership: model("membership", "createdAt"),
  },
}));

const { getLeadTimeline } = await import("@/lib/leads/timeline");

const at = (iso: string) => new Date(iso);

beforeEach(() => {
  data.emailEvent = [];
  data.contactEvent = [];
  data.dripEnrollment = [];
  data.contactNote = [];
  data.contactCall = [];
  data.contactMessage = [];
  data.leadBooking = [];
  data.payment = [];
  data.membership = [];
  contactRow = { email: "lead@example.com" };
});

describe("getLeadTimeline", () => {
  it("merges every source into one newest-first feed", async () => {
    data.emailEvent = [
      { type: "SENT", subject: "Hello", url: null, metadata: null, createdAt: at("2026-08-02T10:00:00Z") },
      { type: "CLICKED", subject: "Hello", url: "https://x.test/a", metadata: null, createdAt: at("2026-08-04T10:00:00Z") },
    ];
    data.contactEvent = [
      { type: "ASSET_DOWNLOAD", metadata: JSON.stringify({ fileName: "guide.pdf" }), createdAt: at("2026-08-03T10:00:00Z") },
    ];
    data.contactNote = [
      { body: "Called, left voicemail", authorLabel: "Lex", kind: "MANUAL", createdAt: at("2026-08-05T10:00:00Z") },
    ];
    data.dripEnrollment = [
      {
        enrolledAt: at("2026-08-01T10:00:00Z"), completedAt: null, exitedAt: null, exitReason: null,
        campaign: { name: "Nurture", slug: "nurture", id: "c1" },
      },
    ];

    const page = await getLeadTimeline("contact_1");
    expect(page.items.map((i) => i.kind)).toEqual([
      "note", "email_clicked", "asset_download", "email_sent", "drip_enrolled",
    ]);
    // Strictly descending.
    const times = page.items.map((i) => i.at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("resolves labels and details from each source's own shape", async () => {
    data.contactEvent = [
      { type: "LESSON_VIEW", metadata: JSON.stringify({ lessonTitle: "Agents 101" }), createdAt: at("2026-08-03T10:00:00Z") },
    ];
    data.emailEvent = [
      { type: "CLICKED", subject: "Seat?", url: "https://luma.test/x", metadata: null, createdAt: at("2026-08-02T10:00:00Z") },
    ];
    data.contactNote = [
      { body: "Send deck", authorLabel: "Drip: Nurture", kind: "DRIP_TASK", createdAt: at("2026-08-01T10:00:00Z") },
    ];

    const items = (await getLeadTimeline("c")).items;
    expect(items[0]).toMatchObject({ label: "Viewed a lesson", detail: "Agents 101" });
    expect(items[1]).toMatchObject({ label: "Link clicked", href: "https://luma.test/x" });
    expect(items[2]).toMatchObject({ label: "Follow-up task", detail: "Drip: Nurture: Send deck" });
  });

  it("renders a purchase ContactEvent with its kind and reference", async () => {
    data.contactEvent = [
      {
        type: "PURCHASE",
        metadata: JSON.stringify({ kind: "COHORT", refId: "payment_1" }),
        createdAt: at("2026-08-03T10:00:00Z"),
      },
    ];

    expect((await getLeadTimeline("c")).items[0]).toMatchObject({
      kind: "purchase",
      label: "Purchase: COHORT",
      detail: "payment_1",
    });
  });

  it("splits one enrollment into its separate dated moments", async () => {
    data.dripEnrollment = [
      {
        enrolledAt: at("2026-08-01T10:00:00Z"),
        completedAt: null,
        exitedAt: at("2026-08-06T10:00:00Z"),
        exitReason: "unsubscribed",
        campaign: { name: "Nurture", slug: "nurture", id: "c1" },
      },
    ];
    const items = (await getLeadTimeline("c")).items;
    expect(items.map((i) => i.kind)).toEqual(["drip_exited", "drip_enrolled"]);
    expect(items[0].detail).toBe("Nurture · unsubscribed");
  });

  it("paginates: a full page returns a cursor, and the next page continues from it", async () => {
    data.emailEvent = Array.from({ length: 5 }, (_, i) => ({
      type: "SENT",
      subject: `Message ${i}`,
      url: null,
      metadata: null,
      createdAt: at(`2026-08-0${i + 1}T10:00:00Z`),
    }));

    const first = await getLeadTimeline("c", { take: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe(first.items[1].at);

    const second = await getLeadTimeline("c", { take: 2, before: first.nextCursor });
    expect(second.items).toHaveLength(2);
    // No overlap between pages.
    const seen = new Set(first.items.map((i) => i.detail));
    expect(second.items.every((i) => !seen.has(i.detail))).toBe(true);
  });

  it("returns a null cursor once the feed is drained", async () => {
    data.emailEvent = [
      { type: "SENT", subject: "only", url: null, metadata: null, createdAt: at("2026-08-01T10:00:00Z") },
    ];
    const page = await getLeadTimeline("c", { take: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it("over-fetches each source so any one of them can fill a page", async () => {
    await getLeadTimeline("c", { take: 5 });
    expect(lastArgs.emailEvent.take).toBe(16);
    expect(lastArgs.contactNote.take).toBe(6);
  });

  it("clamps take to a sane bound rather than trusting the caller", async () => {
    await getLeadTimeline("c", { take: 10_000 });
    expect(lastArgs.emailEvent.take).toBe(200);
  });

  it("ignores an unparseable cursor instead of returning nothing", async () => {
    data.emailEvent = [
      { type: "SENT", subject: "x", url: null, metadata: null, createdAt: at("2026-08-01T10:00:00Z") },
    ];
    const page = await getLeadTimeline("c", { before: "not-a-date" });
    expect(page.items).toHaveLength(1);
  });

  it("surfaces the failure reason on a failed send", async () => {
    data.emailEvent = [
      {
        type: "FAILED", subject: "Hi", url: null,
        metadata: JSON.stringify({ error: "550 mailbox unavailable" }),
        createdAt: at("2026-08-01T10:00:00Z"),
      },
    ];
    const items = (await getLeadTimeline("c")).items;
    expect(items[0].kind).toBe("email_failed");
    expect(items[0].detail).toContain("550 mailbox unavailable");
  });

  it("labels one-off email activity without implying a drip campaign step", async () => {
    data.emailEvent = [
      {
        type: "SENT",
        subject: "Checking in",
        url: null,
        metadata: JSON.stringify({ kind: "oneoff", staffId: "staff_1" }),
        createdAt: at("2026-08-01T10:00:00Z"),
      },
    ];
    const items = (await getLeadTimeline("c")).items;
    expect(items[0]).toMatchObject({
      kind: "email_sent",
      label: "One-off email sent",
      detail: "Checking in",
    });
  });

  // Money sources: a checkout contributes the attempt AND its outcome, so staff
  // can see "started → abandoned → paid" against the emails that drove it.
  it("splits a checkout into its attempt and its outcome", async () => {
    data.payment = [
      {
        amount: 15000, currency: "usd", status: "paid", couponCode: "COMEBACK10",
        cohort: { title: "10-Day Intensive" }, venueEvent: null,
        createdAt: at("2026-08-01T10:00:00Z"), updatedAt: at("2026-08-03T10:00:00Z"),
      },
    ];
    const items = (await getLeadTimeline("c")).items;
    expect(items.map((i) => i.kind)).toEqual(["purchase", "checkout_started"]);
    // The coupon that produced the sale is visible on the row, and money is
    // formatted from cents rather than carried as a float.
    expect(items[0].detail).toBe("10-Day Intensive · $150.00 · COMEBACK10");
  });

  it("marks an expired checkout abandoned and a membership by tier", async () => {
    data.payment = [
      {
        amount: 15000, currency: "usd", status: "failed", couponCode: null,
        cohort: { title: "3-Week Evening" }, venueEvent: null,
        createdAt: at("2026-08-01T10:00:00Z"), updatedAt: at("2026-08-01T10:30:00Z"),
      },
    ];
    data.membership = [
      {
        amount: 5000, tier: "MENTOR_NETWORK", status: "expired",
        createdAt: at("2026-08-02T10:00:00Z"), updatedAt: at("2026-08-02T10:30:00Z"),
      },
    ];
    const items = (await getLeadTimeline("c")).items;
    expect(items.map((i) => i.kind)).toEqual([
      "checkout_abandoned", "checkout_started", "checkout_abandoned", "checkout_started",
    ]);
    expect(items[0].detail).toContain("MENTOR_NETWORK");
    expect(items[1].detail).toContain("$50.00/mo");
  });

  it("returns no money rows when the contact has no email to key them on", async () => {
    contactRow = null;
    data.payment = [
      {
        amount: 15000, currency: "usd", status: "paid", couponCode: null,
        cohort: { title: "Intensive" }, venueEvent: null,
        createdAt: at("2026-08-01T10:00:00Z"), updatedAt: at("2026-08-01T10:00:00Z"),
      },
    ];
    expect((await getLeadTimeline("c")).items).toHaveLength(0);
  });

  it("SC2.1: includes the rendered body and campaign on a sent email", async () => {
    data.emailEvent = [
      {
        id: "email_1", type: "SENT", subject: "Welcome", bodyHtml: "<p>Hello</p>",
        url: null, metadata: null, dripSendId: "send_1",
        dripSend: { step: { campaign: { id: "campaign_1", name: "Welcome Series" } } },
        createdAt: at("2026-08-01T10:00:00Z"),
      },
    ];

    const page = await getLeadTimeline("c");
    expect(page.items).toHaveLength(1);
    expect(page.items[0].email).toEqual({
      id: "email_1",
      subject: "Welcome",
      bodyHtml: "<p>Hello</p>",
      campaignName: "Welcome Series",
    });
  });

  it("SC2.2: folds drip and one-off opens and clicks into their sent emails", async () => {
    data.emailEvent = [
      {
        id: "drip_click", type: "CLICKED", subject: "Drip", bodyHtml: null,
        url: "https://example.com/drip", metadata: null, dripSendId: "send_1", dripSend: null,
        createdAt: at("2026-08-04T10:00:00Z"),
      },
      {
        id: "drip_open", type: "OPENED", subject: "Drip", bodyHtml: null,
        url: null, metadata: null, dripSendId: "send_1", dripSend: null,
        createdAt: at("2026-08-03T10:00:00Z"),
      },
      {
        id: "oneoff_click", type: "CLICKED", subject: "One-off", bodyHtml: null,
        url: "https://example.com/oneoff",
        metadata: JSON.stringify({ sourceEmailEventId: "oneoff_sent" }),
        dripSendId: null, dripSend: null, createdAt: at("2026-08-02T12:00:00Z"),
      },
      {
        id: "oneoff_open", type: "OPENED", subject: "One-off", bodyHtml: null, url: null,
        metadata: JSON.stringify({ sourceEmailEventId: "oneoff_sent" }),
        dripSendId: null, dripSend: null, createdAt: at("2026-08-02T11:00:00Z"),
      },
      {
        id: "oneoff_sent", type: "SENT", subject: "One-off", bodyHtml: "<p>One-off</p>",
        url: null, metadata: JSON.stringify({ kind: "oneoff" }), dripSendId: null, dripSend: null,
        createdAt: at("2026-08-02T10:00:00Z"),
      },
      {
        id: "drip_sent", type: "SENT", subject: "Drip", bodyHtml: "<p>Drip</p>",
        url: null, metadata: null, dripSendId: "send_1", dripSend: null,
        createdAt: at("2026-08-01T10:00:00Z"),
      },
    ];

    const items = (await getLeadTimeline("c")).items;
    expect(items).toHaveLength(2);
    expect(items[0].email).toMatchObject({
      id: "oneoff_sent",
      openedAt: "2026-08-02T11:00:00.000Z",
      clickedAt: "2026-08-02T12:00:00.000Z",
      clickedUrl: "https://example.com/oneoff",
    });
    expect(items[1].email).toMatchObject({
      id: "drip_sent",
      openedAt: "2026-08-03T10:00:00.000Z",
      clickedAt: "2026-08-04T10:00:00.000Z",
      clickedUrl: "https://example.com/drip",
    });
  });

  it("SC2.3: keeps failed, bounced, and unsubscribed emails standalone", async () => {
    data.emailEvent = ["FAILED", "BOUNCED", "UNSUBSCRIBED"].map((type, index) => ({
      id: `email_${index}`, type, subject: type, bodyHtml: null, url: null, metadata: null,
      dripSendId: "send_1", dripSend: null,
      createdAt: at(`2026-08-0${index + 1}T10:00:00Z`),
    }));

    expect((await getLeadTimeline("c")).items.map((item) => item.kind)).toEqual([
      "email_unsubscribed", "email_failed", "email_failed",
    ]);
  });

  it("SC2.4: renders legacy sent emails without a stored body", async () => {
    data.emailEvent = [
      {
        id: "legacy", type: "SENT", subject: "Legacy", bodyHtml: null, url: null,
        metadata: null, dripSendId: null, dripSend: null,
        createdAt: at("2026-08-01T10:00:00Z"),
      },
    ];

    const item = (await getLeadTimeline("c")).items[0];
    expect(item.email).toMatchObject({ id: "legacy", subject: "Legacy" });
    expect(item.email?.bodyHtml).toBeUndefined();
  });

  it("SC2.5: fills a page and returns a cursor after folding engagement", async () => {
    data.emailEvent = [
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `open_${index}`, type: "OPENED", subject: "Newest", bodyHtml: null, url: null,
        metadata: null, dripSendId: "send_new", dripSend: null,
        createdAt: at(`2026-08-07T1${index}:00:00Z`),
      })),
      ...["new", "middle", "old"].map((suffix, index) => ({
        id: `sent_${suffix}`, type: "SENT", subject: suffix, bodyHtml: `<p>${suffix}</p>`,
        url: null, metadata: null, dripSendId: `send_${suffix}`, dripSend: null,
        createdAt: at(`2026-08-0${3 - index}T10:00:00Z`),
      })),
    ];

    const page = await getLeadTimeline("c", { take: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.items.map((item) => item.email?.id)).toEqual(["sent_new", "sent_middle"]);
    expect(page.nextCursor).toBe(page.items[1].at);
  });

  it("SC2.6: keeps engagement standalone when its sent parent was not fetched", async () => {
    data.emailEvent = [
      {
        id: "orphan_open", type: "OPENED", subject: "Older send", bodyHtml: null,
        url: null, metadata: null, dripSendId: "missing_send", dripSend: null,
        createdAt: at("2026-08-05T10:00:00Z"),
      },
    ];

    expect((await getLeadTimeline("c")).items).toEqual([
      expect.objectContaining({ kind: "email_opened", label: "Email opened", detail: "Older send" }),
    ]);
  });
});
