import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

type Contact = { id: string; name: string; phone: string };
type ContactCall = {
  id: string;
  provider: string;
  providerCallId: string;
  direction: string;
  status: string;
  contactId: string;
  phoneNumber: string;
  startedAt: Date;
};

const contacts: Contact[] = [];
const calls: ContactCall[] = [];
let failNextContactCreate = false;

const contactFindFirst = mock(async ({ where }: { where: { phone: string } }) =>
  contacts.find((contact) => contact.phone === where.phone) ?? null
);
const contactCreate = mock(
  async ({ data }: { data: Record<string, unknown> }): Promise<Contact> => {
    if (failNextContactCreate) {
      failNextContactCreate = false;
      throw new Error("unique email race");
    }
    const contact = {
      id: `contact-${contacts.length + 1}`,
      name: String(data.name),
      phone: String(data.phone),
    };
    contacts.push(contact);
    return contact;
  }
);
const contactCallUpsert = mock(
  async ({ where, create }: { where: { providerCallId: string }; create: Omit<ContactCall, "id"> }) => {
    const existing = calls.find((call) => call.providerCallId === where.providerCallId);
    if (existing) return existing;
    const call = { id: `call-${calls.length + 1}`, ...create };
    calls.push(call);
    return call;
  }
);

mock.module("@/lib/prisma", () => ({
  default: {
    contact: {
      findFirst: contactFindFirst,
      create: contactCreate,
    },
    contactCall: {
      upsert: contactCallUpsert,
    },
  },
}));

const {
  createInboundVapiContactCall,
  createUnknownCaller,
  findOrCreateContactByPhone,
  inboundVapiCallPlan,
} = await import("@/lib/calls/inboundContact");

beforeEach(() => {
  contacts.length = 0;
  calls.length = 0;
  failNextContactCreate = false;
  contactFindFirst.mockClear();
  contactCreate.mockClear();
  contactCallUpsert.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("Vapi unknown inbound call handling", () => {
  it("SCV.1: plans an inbound call and creates its contact and INBOUND Vapi ContactCall", async () => {
    const plan = inboundVapiCallPlan({
      call: {
        id: "vapi-call-1",
        type: "inboundPhoneCall",
        customer: { number: "+1 (415) 555-2671" },
      },
    });

    expect(plan).toEqual({
      action: "create",
      providerCallId: "vapi-call-1",
      rawPhone: "+1 (415) 555-2671",
      phone: "+14155552671",
    });
    if (plan.action !== "create") throw new Error("expected create plan");

    const call = await createInboundVapiContactCall(plan);

    expect(call).toMatchObject({
      provider: "vapi",
      providerCallId: "vapi-call-1",
      direction: "INBOUND",
      status: "INITIATED",
      contactId: "contact-1",
      phoneNumber: "+14155552671",
    });
    expect(call.startedAt).toBeInstanceOf(Date);
  });

  it("SCV.2: skips outbound and web calls without any database writes", async () => {
    for (const type of ["outboundPhoneCall", "webCall"]) {
      expect(
        inboundVapiCallPlan({
          call: { id: `vapi-${type}`, type, customer: { number: "+14155552671" } },
        })
      ).toEqual({ action: "skip", reason: "not-inbound" });
    }
    expect(contactCreate).not.toHaveBeenCalled();
    expect(contactCallUpsert).not.toHaveBeenCalled();
  });

  it("SCV.3: duplicate inbound delivery leaves exactly one ContactCall row", async () => {
    const plan = inboundVapiCallPlan({
      call: {
        id: "vapi-duplicate",
        type: "inboundPhoneCall",
        customer: { number: "+14155552671" },
      },
    });
    if (plan.action !== "create") throw new Error("expected create plan");

    const first = await createInboundVapiContactCall(plan);
    const second = await createInboundVapiContactCall(plan);

    expect(second.id).toBe(first.id);
    expect(calls).toHaveLength(1);
    expect(contactCallUpsert).toHaveBeenCalledTimes(2);
  });

  it("SCV.4: creates deterministic unknown-caller identity without granting consent", async () => {
    const contact = await createUnknownCaller(
      "+1 (415) 555-2671",
      "+14155552671",
      "vapi-new-caller",
      "[vapi webhook]"
    );

    expect(contact.id).toBe("contact-1");
    expect(contactCreate).toHaveBeenCalledWith({
      data: {
        email: "inbound-call-14155552671@unknown.invalid",
        name: "Unknown caller +1 (415) 555-2671",
        phone: "+14155552671",
        status: "NEW",
        source: "inbound-call",
        unsubscribedAt: null,
        phoneConsentAt: null,
        doNotCall: false,
        smsOptOutAt: null,
      },
      select: { id: true, name: true },
    });
  });

  it("SCV.4: recovers a concurrent unknown-caller create by re-querying phone", async () => {
    contacts.push({ id: "race-winner", name: "Unknown caller", phone: "+14155552671" });
    failNextContactCreate = true;

    const contact = await createUnknownCaller(
      "+14155552671",
      "+14155552671",
      "vapi-race",
      "[vapi webhook]"
    );

    expect(contact.id).toBe("race-winner");
    expect(contactFindFirst).toHaveBeenCalledWith({
      where: { phone: "+14155552671" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    });
  });

  it("SCV.4: find-or-create reuses an existing phone contact", async () => {
    contacts.push({ id: "known", name: "Known Lead", phone: "+14155552671" });

    const contact = await findOrCreateContactByPhone(
      "+14155552671",
      "+14155552671",
      "vapi-known",
      "[vapi webhook]"
    );

    expect(contact.id).toBe("known");
    expect(contactCreate).not.toHaveBeenCalled();
  });

  it("SCV.5: skips missing, non-string, and invalid caller numbers", () => {
    for (const number of [undefined, null, 14155552671, "not-a-phone"]) {
      expect(
        inboundVapiCallPlan({
          call: {
            id: "vapi-invalid-number",
            type: "inboundPhoneCall",
            customer: { number },
          },
        })
      ).toEqual({ action: "skip", reason: "invalid-phone" });
    }
    expect(inboundVapiCallPlan(null)).toEqual({ action: "skip", reason: "invalid-call" });
    expect(contactCreate).not.toHaveBeenCalled();
    expect(contactCallUpsert).not.toHaveBeenCalled();
  });
});
