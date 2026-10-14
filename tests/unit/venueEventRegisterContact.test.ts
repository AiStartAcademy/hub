import { beforeEach, describe, expect, it, mock } from "bun:test";

// `server-only` is a Next build marker rather than an installed runtime module,
// so there is no actual module to spread in Bun. This is the repository's
// established route-test shim for modules (such as waiver.ts) that import it.
mock.module("server-only", () => ({}));

type ContactRow = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  tags: string | null;
};

type DataRecord = Record<string, unknown>;

type ContactFindUniqueArgs = {
  where: { email: string };
  select?: DataRecord;
};

type ContactWriteArgs = {
  where?: { email: string };
  data: DataRecord;
  select?: DataRecord;
};

const submittedPhone = "+15550001111";
const existingPhone = "+15550002222";
const contacts: ContactRow[] = [];
const contactCreates: ContactWriteArgs[] = [];
const contactUpdates: ContactWriteArgs[] = [];

const eventRecord = {
  id: "venue-event-1",
  slug: "camera-basics",
  title: "Camera Basics",
  date: new Date("2026-10-10T00:00:00.000Z"),
  startTime: "10:00 AM",
  endTime: "12:00 PM",
  status: "APPROVED",
  capacity: null,
  isOnline: true,
  ticketPriceCents: null,
  ticketPaymentLink: null,
  externalRegistrationUrl: null,
};

const contactModel = {
  findUnique: async (args: ContactFindUniqueArgs): Promise<ContactRow | null> =>
    contacts.find((contact) => contact.email === args.where.email) ?? null,
  update: async (args: ContactWriteArgs): Promise<ContactRow> => {
    if (!args.where) throw new Error("Contact update requires an email");
    const contact = contacts.find((row) => row.email === args.where?.email);
    if (!contact) throw new Error(`Mock contact ${args.where.email} not found`);
    contactUpdates.push(args);
    Object.assign(contact, args.data);
    return contact;
  },
  create: async (args: ContactWriteArgs): Promise<ContactRow> => {
    contactCreates.push(args);
    const contact: ContactRow = {
      id: `contact-${contacts.length + 1}`,
      email: String(args.data.email),
      name: String(args.data.name),
      phone: typeof args.data.phone === "string" ? args.data.phone : null,
      tags: typeof args.data.tags === "string" ? args.data.tags : null,
    };
    contacts.push(contact);
    return contact;
  },
};

const transactionClient = {
  contact: contactModel,
  contactEvent: {
    create: async (args: { data: DataRecord }): Promise<DataRecord> => args.data,
  },
  venueEventRegistration: {
    findUnique: async (): Promise<null> => null,
    count: async (): Promise<number> => 0,
    upsert: async (args: {
      where: DataRecord;
      update: DataRecord;
      create: DataRecord;
    }): Promise<DataRecord> => args.create,
  },
};

const prismaMock = {
  venueEvent: {
    findUnique: async (): Promise<typeof eventRecord> => eventRecord,
  },
  $transaction: async <T>(
    callback: (tx: typeof transactionClient) => Promise<T>,
  ): Promise<T> => callback(transactionClient),
};

const actualPrisma = await import("@/lib/prisma");
mock.module("@/lib/prisma", () => ({
  ...actualPrisma,
  default: prismaMock,
}));

const actualHeaders = await import("next/headers");
mock.module("next/headers", () => ({
  ...actualHeaders,
  cookies: async () => ({
    get: (): undefined => undefined,
  }),
}));

const actualMail = await import("@/lib/mail");
mock.module("@/lib/mail", () => ({
  ...actualMail,
  sendMail: async (): Promise<void> => undefined,
}));

const { POST } = await import(
  "@/app/api/public/venue-events/[slug]/register/route"
);

function seedContact(phone: string | null): ContactRow {
  const contact: ContactRow = {
    id: "contact-existing",
    email: "registrant@example.com",
    name: "Existing Registrant",
    phone,
    tags: null,
  };
  contacts.push(contact);
  return contact;
}

async function register(): Promise<Response> {
  return POST(
    new Request("https://hub.example/api/public/venue-events/camera-basics/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `192.0.2.${contacts.length + 10}`,
      },
      body: JSON.stringify({
        name: "Test Registrant",
        email: "registrant@example.com",
        phone: submittedPhone,
        waiverAccepted: false,
      }),
    }),
    { params: Promise.resolve({ slug: "camera-basics" }) },
  );
}

function expectNoConsentFields(data: DataRecord): void {
  expect(data).not.toHaveProperty("phoneConsentAt");
  expect(data).not.toHaveProperty("smsOptOutAt");
  expect(data).not.toHaveProperty("doNotCall");
}

beforeEach(() => {
  contacts.length = 0;
  contactCreates.length = 0;
  contactUpdates.length = 0;
});

describe("venue-event registration Contact phone", () => {
  it("SC-16: the Contact create branch stores the submitted phone", async () => {
    const response = await register();

    expect(response.status).toBe(201);
    expect(contactCreates).toHaveLength(1);
    expect(contactCreates[0].data.phone).toBe(submittedPhone);
    expect(contacts[0].phone).toBe(submittedPhone);
  });

  it("SC-17: the Contact update branch fills a blank phone and preserves an existing number", async () => {
    const blankContact = seedContact(null);
    const blankResponse = await register();

    expect(blankResponse.status).toBe(201);
    expect(blankContact.phone).toBe(submittedPhone);
    expect(contactUpdates[0].data.phone).toBe(submittedPhone);

    contacts.length = 0;
    contactUpdates.length = 0;
    const populatedContact = seedContact(existingPhone);
    const populatedResponse = await register();

    expect(populatedResponse.status).toBe(201);
    expect(populatedContact.phone).toBe(existingPhone);
    expect(contactUpdates[0].data).not.toHaveProperty("phone");
  });

  it("SC-18: neither Contact branch writes consent, SMS opt-out, or do-not-call fields", async () => {
    const createResponse = await register();
    expect(createResponse.status).toBe(201);
    expectNoConsentFields(contactCreates[0].data);

    contacts.length = 0;
    contactCreates.length = 0;
    seedContact(null);

    const updateResponse = await register();
    expect(updateResponse.status).toBe(201);
    expectNoConsentFields(contactUpdates[0].data);
  });
});
