import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Prisma } from "@/generated/client";

type Row = Record<string, unknown>;

function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["campaignId", "contactId", "cohortId"] },
  });
}

const NOW = new Date("2026-09-08T18:00:00.000Z");

const calls = {
  campaignFindFirst: [] as Row[],
  cohortFindUnique: [] as Row[],
  certificateFindMany: [] as Row[],
  certificateUpdate: [] as Row[],
  contactFindUnique: [] as Row[],
  contactUpsert: [] as Row[],
  enrollmentCreate: [] as Row[],
};

let enrollmentKeys: Set<string>;
let enrollmentFailure: unknown = null;

function enrollmentKey(row: Row): string {
  return `${String(row.campaignId)}:${String(row.contactId)}:${String(row.cohortId ?? "")}`;
}

let campaign: Row | null;
let certificates: Row[];
let contactsByEmail: Map<string, Row>;

function makeCertificate(id: string, overrides: Row = {}): Row {
  return {
    id,
    cohortId: "cohort-1",
    notifiedAt: null,
    isRevoked: false,
    user: { email: `${id}@example.com`, name: `Learner ${id}` },
    ...overrides,
  };
}

const prismaMock = {
  dripCampaign: {
    findFirst: async (args: Row) => {
      calls.campaignFindFirst.push(args);
      return campaign;
    },
  },
  cohort: {
    findUnique: async (args: Row) => {
      calls.cohortFindUnique.push(args);
      return { id: "cohort-1", slug: "fall-2026" };
    },
  },
  certificate: {
    findMany: async (args: Row) => {
      calls.certificateFindMany.push(args);
      const where = (args.where ?? {}) as Row;
      const idFilter = (where.id ?? {}) as Row;
      const ids = Array.isArray(idFilter.in) ? (idFilter.in as string[]) : null;
      return certificates.filter(
        (certificate) =>
          certificate.cohortId === where.cohortId &&
          (!ids || ids.includes(String(certificate.id)))
      );
    },
    update: async (args: Row) => {
      calls.certificateUpdate.push(args);
      const where = (args.where ?? {}) as Row;
      const certificate = certificates.find((item) => item.id === where.id);
      if (certificate) Object.assign(certificate, (args.data ?? {}) as Row);
      return certificate;
    },
  },
  contact: {
    findUnique: async (args: Row) => {
      calls.contactFindUnique.push(args);
      const where = (args.where ?? {}) as Row;
      return contactsByEmail.get(String(where.email)) ?? null;
    },
    upsert: async (args: Row) => {
      calls.contactUpsert.push(args);
      const where = (args.where ?? {}) as Row;
      const email = String(where.email);
      const existing = contactsByEmail.get(email);
      if (existing) return existing;
      const created = {
        id: `contact-${email}`,
        unsubscribedAt: null,
        courseEmailOptOutAt: null,
        ...((args.create ?? {}) as Row),
      };
      contactsByEmail.set(email, created);
      return created;
    },
  },
  dripEnrollment: {
    create: async (args: Row) => {
      calls.enrollmentCreate.push(args);
      if (enrollmentFailure) throw enrollmentFailure;
      const data = (args.data ?? {}) as Row;
      const key = enrollmentKey(data);
      if (enrollmentKeys.has(key)) throw uniqueConstraintError();
      enrollmentKeys.add(key);
      return data;
    },
  },
  $transaction: async (operation: unknown) => {
    if (typeof operation === "function") return operation(prismaMock);
    return Promise.all(operation as Promise<unknown>[]);
  },
};

mock.module("@/lib/prisma", () => ({ default: prismaMock }));

const { enrollCertificateNotifications } = await import(
  "@/lib/drip/certificateNotify"
);

function resetFixtures(): void {
  calls.campaignFindFirst.length = 0;
  calls.cohortFindUnique.length = 0;
  calls.certificateFindMany.length = 0;
  calls.certificateUpdate.length = 0;
  calls.contactFindUnique.length = 0;
  calls.contactUpsert.length = 0;
  calls.enrollmentCreate.length = 0;
  enrollmentKeys = new Set();
  enrollmentFailure = null;
  campaign = {
    id: "certificate-campaign",
    status: "ACTIVE",
    trigger: "CERTIFICATE_ISSUED",
    priority: 0,
  };
  certificates = [];
  contactsByEmail = new Map();
}

describe("enrollCertificateNotifications", () => {
  beforeEach(resetFixtures);

  it("queues one enrollment per un-notified, non-revoked certificate and stamps notifiedAt", async () => {
    certificates = [makeCertificate("cert-1")];

    const result = await enrollCertificateNotifications("cohort-1", { now: NOW });

    expect(result).toEqual({
      ok: true,
      queued: 1,
      alreadyNotified: 0,
      revoked: 0,
      noEmail: 0,
      unsubscribed: 0,
    });
    expect(calls.campaignFindFirst).toEqual([
      expect.objectContaining({
        where: { status: "ACTIVE", trigger: "CERTIFICATE_ISSUED" },
        orderBy: { priority: "asc" },
      }),
    ]);
    expect(calls.contactUpsert[0]).toEqual(
      expect.objectContaining({
        where: { email: "cert-1@example.com" },
        update: expect.objectContaining({ tags: JSON.stringify(["cohort:fall-2026"]) }),
        create: expect.objectContaining({
          status: "NEW",
          source: "certificate-notify",
        }),
      })
    );
    expect(calls.enrollmentCreate).toEqual([
      {
        data: {
          campaignId: "certificate-campaign",
          contactId: "contact-cert-1@example.com",
          cohortId: "cohort-1",
          status: "ACTIVE",
          lastStepOrder: 0,
          nextRunAt: NOW,
        },
      },
    ]);
    expect(calls.certificateUpdate).toEqual([
      { where: { id: "cert-1" }, data: { notifiedAt: NOW } },
    ]);
  });

  it("SC-3/SC-4: a duplicate enrollment (P2002) still stamps notifiedAt and counts as queued", async () => {
    certificates = [makeCertificate("cert-dup")];
    // Pre-seed the enrollment so the create collides on (campaignId, contactId, cohortId).
    enrollmentKeys.add(
      "certificate-campaign:contact-cert-dup@example.com:cohort-1"
    );

    const result = await enrollCertificateNotifications("cohort-1", { now: NOW });

    expect(result).toEqual({
      ok: true,
      queued: 1,
      alreadyNotified: 0,
      revoked: 0,
      noEmail: 0,
      unsubscribed: 0,
    });
    expect(calls.enrollmentCreate).toHaveLength(1);
    expect(calls.certificateUpdate).toEqual([
      { where: { id: "cert-dup" }, data: { notifiedAt: NOW } },
    ]);
  });

  it("SC-3: a non-P2002 enrollment error propagates instead of being swallowed", async () => {
    certificates = [makeCertificate("cert-boom")];
    enrollmentFailure = new Prisma.PrismaClientKnownRequestError(
      "Foreign key constraint failed",
      { code: "P2003", clientVersion: "test" }
    );

    await expect(
      enrollCertificateNotifications("cohort-1", { now: NOW })
    ).rejects.toThrow(/Failed to enroll certificate notifications/);
    expect(calls.certificateUpdate).toHaveLength(0);
  });

  it("skips certificates already notified (idempotent on re-run)", async () => {
    certificates = [makeCertificate("cert-1")];

    const first = await enrollCertificateNotifications("cohort-1", { now: NOW });
    const second = await enrollCertificateNotifications("cohort-1", { now: NOW });

    expect(first).toMatchObject({ ok: true, queued: 1, alreadyNotified: 0 });
    expect(second).toEqual({
      ok: true,
      queued: 0,
      alreadyNotified: 1,
      revoked: 0,
      noEmail: 0,
      unsubscribed: 0,
    });
    expect(calls.enrollmentCreate).toHaveLength(1);
    expect(calls.certificateUpdate).toHaveLength(1);
  });

  it("queues course-email opted-out contacts (email step skipped by the engine, SMS still eligible) and counts them", async () => {
    certificates = [makeCertificate("cert-unsub")];
    contactsByEmail.set("cert-unsub@example.com", {
      id: "contact-unsub",
      tags: "[]",
      courseEmailOptOutAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    const result = await enrollCertificateNotifications("cohort-1", { now: NOW });

    expect(result).toEqual({
      ok: true,
      queued: 1,
      alreadyNotified: 0,
      revoked: 0,
      noEmail: 0,
      unsubscribed: 1,
    });
    expect(calls.enrollmentCreate).toHaveLength(1);
    expect(calls.certificateUpdate).toHaveLength(1);
  });

  it("dryRun reports counts and writes nothing", async () => {
    certificates = [
      makeCertificate("cert-queue"),
      makeCertificate("cert-notified", { notifiedAt: NOW }),
      makeCertificate("cert-revoked", { isRevoked: true }),
      makeCertificate("cert-no-email", {
        user: { email: null, name: "No Email" },
      }),
      makeCertificate("cert-unsub"),
    ];
    contactsByEmail.set("cert-queue@example.com", {
      id: "contact-queue",
      tags: "[]",
      courseEmailOptOutAt: null,
    });
    contactsByEmail.set("cert-unsub@example.com", {
      id: "contact-unsub",
      tags: "[]",
      courseEmailOptOutAt: NOW,
    });

    const result = await enrollCertificateNotifications("cohort-1", {
      dryRun: true,
      now: NOW,
    });

    expect(result).toEqual({
      ok: true,
      queued: 2,
      alreadyNotified: 1,
      revoked: 1,
      noEmail: 1,
      unsubscribed: 1,
    });
    expect(calls.contactUpsert).toHaveLength(0);
    expect(calls.enrollmentCreate).toHaveLength(0);
    expect(calls.certificateUpdate).toHaveLength(0);
  });

  it("returns campaignMissing when no ACTIVE CERTIFICATE_ISSUED campaign exists", async () => {
    campaign = null;
    certificates = [makeCertificate("cert-1")];

    const result = await enrollCertificateNotifications("cohort-1", { now: NOW });

    expect(result).toEqual({
      ok: false,
      queued: 0,
      alreadyNotified: 0,
      revoked: 0,
      noEmail: 0,
      unsubscribed: 0,
      campaignMissing: true,
    });
    expect(calls.contactUpsert).toHaveLength(0);
    expect(calls.enrollmentCreate).toHaveLength(0);
    expect(calls.certificateUpdate).toHaveLength(0);
  });

  it("restricts to certificateIds when provided", async () => {
    certificates = [makeCertificate("cert-1"), makeCertificate("cert-2")];

    const result = await enrollCertificateNotifications("cohort-1", {
      certificateIds: ["cert-2"],
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true, queued: 1 });
    expect(calls.certificateFindMany[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          cohortId: "cohort-1",
          id: { in: ["cert-2"] },
        }),
      })
    );
    expect(calls.enrollmentCreate).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ contactId: "contact-cert-2@example.com" }),
      }),
    ]);
    expect(calls.certificateUpdate).toEqual([
      { where: { id: "cert-2" }, data: { notifiedAt: NOW } },
    ]);
  });
});
