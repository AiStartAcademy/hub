import { beforeEach, describe, expect, it, mock } from "bun:test";
import type Stripe from "stripe";

type DataRecord = Record<string, unknown>;

type ContactRow = {
  email: string;
  phone: string | null;
};

type ContactUpdateArgs = {
  where: DataRecord;
  data: DataRecord;
};

const submittedPhone = "+15550001111";
const existingPhone = "+15550002222";
const contact: ContactRow = {
  email: "buyer@example.com",
  phone: null,
};
const contactWrites: ContactUpdateArgs[] = [];
let contactWriteFailure: Error | null = null;
let contactWriteAttempts = 0;
let stripeEvent: Stripe.Event;

function matchesFillIfEmpty(where: DataRecord): boolean {
  const emailMatches = where.email === contact.email;
  const phoneConstraint = where.phone;
  const phoneMatches =
    phoneConstraint === undefined ||
    phoneConstraint === contact.phone ||
    (phoneConstraint !== null &&
      typeof phoneConstraint === "object" &&
      "in" in phoneConstraint &&
      Array.isArray((phoneConstraint as { in: unknown }).in) &&
      ((phoneConstraint as { in: unknown[] }).in.includes(contact.phone)));
  return emailMatches && phoneMatches;
}

async function writeContact(args: ContactUpdateArgs): Promise<DataRecord> {
  contactWriteAttempts += 1;
  if (contactWriteFailure) throw contactWriteFailure;
  contactWrites.push(args);
  if (typeof args.data.phone === "string") contact.phone = args.data.phone;
  return { ...contact };
}

const prismaMock = {
  payment: {
    findUnique: async (): Promise<null> => null,
  },
  venueEvent: {
    findFirst: async (): Promise<null> => null,
  },
  contact: {
    findUnique: async (args: { where: DataRecord }): Promise<ContactRow | null> =>
      args.where.email === contact.email ? { ...contact } : null,
    findFirst: async (args: { where: DataRecord }): Promise<ContactRow | null> =>
      args.where.email === contact.email ? { ...contact } : null,
    update: writeContact,
    updateMany: async (args: ContactUpdateArgs): Promise<{ count: number }> => {
      if (!matchesFillIfEmpty(args.where)) return { count: 0 };
      await writeContact(args);
      return { count: 1 };
    },
  },
};

const actualPrisma = await import("@/lib/prisma");
mock.module("@/lib/prisma", () => ({
  ...actualPrisma,
  default: prismaMock,
}));

process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake";

const actualStripe = await import("@/lib/stripe");
mock.module("@/lib/stripe", () => ({
  ...actualStripe,
  stripeConfigured: true,
  stripe: {
    webhooks: {
      constructEvent: (): Stripe.Event => stripeEvent,
    },
  },
}));

const actualLogger = await import("@/lib/logger");
mock.module("@/lib/logger", () => ({
  ...actualLogger,
  logger: {
    ...actualLogger.logger,
    error: (): void => undefined,
    warn: (): void => undefined,
  },
}));

const { POST } = await import("@/app/api/webhooks/stripe/route");

function completedEvent(): Stripe.Event {
  const checkoutSession = {
    id: "cs_test_contact_phone",
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    customer_details: {
      email: contact.email,
      phone: submittedPhone,
    },
    customer_email: contact.email,
    metadata: {},
  } as unknown as Stripe.Checkout.Session;

  return {
    id: "evt_test_contact_phone",
    object: "event",
    api_version: "2025-08-27.basil",
    created: 1_789_555_200,
    data: { object: checkoutSession },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: "checkout.session.completed",
  } as Stripe.Event;
}

async function deliverWebhook(): Promise<Response> {
  stripeEvent = completedEvent();
  const response = await POST(
    new Request("https://hub.example/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "fake-signature" },
      body: "fake-raw-body",
    }),
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return response;
}

function expectNoConsentFields(data: DataRecord): void {
  expect(data).not.toHaveProperty("phoneConsentAt");
  expect(data).not.toHaveProperty("smsOptOutAt");
  expect(data).not.toHaveProperty("doNotCall");
}

beforeEach(() => {
  contact.phone = null;
  contactWrites.length = 0;
  contactWriteAttempts = 0;
  contactWriteFailure = null;
});

describe("Stripe checkout Contact phone", () => {
  it("SC-19: checkout.session.completed fills an empty Contact phone without consent and preserves an existing number", async () => {
    const blankResponse = await deliverWebhook();

    expect(blankResponse.status).toBe(200);
    expect(contact.phone).toBe(submittedPhone);
    expect(contactWrites).toHaveLength(1);
    expectNoConsentFields(contactWrites[0].data);

    contact.phone = existingPhone;
    contactWrites.length = 0;
    contactWriteAttempts = 0;

    const populatedResponse = await deliverWebhook();

    expect(populatedResponse.status).toBe(200);
    expect(contact.phone).toBe(existingPhone);
    expect(contactWrites).toHaveLength(0);
  });

  it("SC-19: a real CRM phone-write failure still returns a non-error webhook response", async () => {
    contactWriteFailure = new Error("simulated Contact phone write failure");

    const response = await deliverWebhook();

    expect(contactWriteAttempts).toBe(1);
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
  });
});
