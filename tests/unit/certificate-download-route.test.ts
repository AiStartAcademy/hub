import { expect, it, mock } from "bun:test";

type CertificateRecord = {
  id: string;
  cohortId: string;
  userId: string;
  pdfUrl: string | null;
  pngUrl: string | null;
  issuedAt: Date;
  notifiedAt: Date | null;
  isRevoked: boolean;
};

const certificates: Record<string, CertificateRecord> = {
  "CERT-1": {
    id: "CERT-1",
    cohortId: "cohort-1",
    userId: "user-1",
    pdfUrl: "certificates/CERT-1.pdf",
    pngUrl: "certificates/CERT-1.png",
    issuedAt: new Date("2026-09-01T00:00:00.000Z"),
    notifiedAt: null,
    isRevoked: false,
  },
  REVOKED: {
    id: "REVOKED",
    cohortId: "cohort-1",
    userId: "user-2",
    pdfUrl: "certificates/REVOKED.pdf",
    pngUrl: "certificates/REVOKED.png",
    issuedAt: new Date("2026-09-01T00:00:00.000Z"),
    notifiedAt: null,
    isRevoked: true,
  },
};

const signedUrlCalls: string[] = [];

mock.module("@/lib/prisma", () => ({
  default: {
    certificate: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        certificates[where.id] ?? null,
    },
  },
}));

// Spread the real module: bun's mock.module registry is process-wide, so a
// partial stub here leaks into every other test file that imports @/lib/gcs
// and makes its untouched exports vanish mid-suite.
const actualGcs = await import("@/lib/gcs");
mock.module("@/lib/gcs", () => ({
  ...actualGcs,
  generateSignedUrl: async (objectUrl: string): Promise<string> => {
    signedUrlCalls.push(objectUrl);
    return `https://storage.example/signed/${encodeURIComponent(objectUrl)}`;
  },
}));

const { GET } = await import("@/app/api/certificates/[id]/download/route");

async function request(id: string, format?: string): Promise<Response> {
  const url = new URL(`https://hub.example/api/certificates/${id}/download`);
  if (format !== undefined) url.searchParams.set("format", format);
  return GET(new Request(url), { params: Promise.resolve({ id }) });
}

it("redirects to a signed url for pdf/png; 404 for unknown or revoked; 400 for bad format", async () => {
  const pdfResponse = await request("CERT-1", "pdf");
  expect(pdfResponse.status).toBe(302);
  expect(pdfResponse.headers.get("location")).toBe(
    "https://storage.example/signed/certificates%2FCERT-1.pdf"
  );

  const pngResponse = await request("CERT-1", "png");
  expect(pngResponse.status).toBe(302);
  expect(pngResponse.headers.get("location")).toBe(
    "https://storage.example/signed/certificates%2FCERT-1.png"
  );
  expect(signedUrlCalls).toEqual([
    "certificates/CERT-1.pdf",
    "certificates/CERT-1.png",
  ]);

  expect((await request("UNKNOWN", "pdf")).status).toBe(404);
  expect((await request("REVOKED", "pdf")).status).toBe(404);
  expect((await request("CERT-1", "jpg")).status).toBe(400);
  expect((await request("CERT-1")).status).toBe(400);
});
