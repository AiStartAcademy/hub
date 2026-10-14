import { brand } from "@/config/brand";
import prisma from "@/lib/prisma";
import { ensureContactForUser, cohortTag } from "./cohortAnchor";
import { CERTIFICATE_TRIGGER } from "./constants";
import { isUniqueConstraintViolation } from "./prismaErrors";

const CERTIFICATE_NOTIFY_SOURCE = "certificate-notify";

export type CertificateNotifyResult = {
  ok: boolean;
  queued: number;
  alreadyNotified: number;
  revoked: number;
  noEmail: number;
  /**
   * Of `queued`, how many opted out of course-update email. They are still enrolled: the
   * engine skips their EMAIL step and sends the SMS step if they gave transactional SMS
   * consent (task 028). Kept under this name for API compatibility.
   */
  unsubscribed: number;
  campaignMissing?: boolean;
};

export type CertificateNotifyOptions = {
  certificateIds?: string[];
  dryRun?: boolean;
  now?: Date;
};

export async function enrollCertificateNotifications(
  cohortId: string,
  opts: CertificateNotifyOptions = {}
): Promise<CertificateNotifyResult> {
  const zeroCounts = {
    queued: 0,
    alreadyNotified: 0,
    revoked: 0,
    noEmail: 0,
    unsubscribed: 0,
  };
  const now = opts.now ?? new Date();

  try {
    const campaign = await prisma.dripCampaign.findFirst({
      where: { status: "ACTIVE", trigger: CERTIFICATE_TRIGGER },
      orderBy: { priority: "asc" },
      select: { id: true },
    });
    if (!campaign) {
      return { ok: false, ...zeroCounts, campaignMissing: true };
    }

    const cohort = await prisma.cohort.findUnique({
      where: { id: cohortId },
      select: { id: true, slug: true },
    });
    if (!cohort) throw new Error(`Cohort ${cohortId} not found`);

    const certificates = await prisma.certificate.findMany({
      where: {
        cohortId,
        isRevoked: false,
        notifiedAt: null,
        ...(opts.certificateIds ? { id: { in: opts.certificateIds } } : {}),
      },
      select: {
        id: true,
        isRevoked: true,
        notifiedAt: true,
        user: { select: { email: true, name: true } },
      },
    });

    const result: CertificateNotifyResult = { ok: true, ...zeroCounts };
    for (const certificate of certificates) {
      if (certificate.isRevoked) {
        result.revoked += 1;
        continue;
      }
      if (certificate.notifiedAt) {
        result.alreadyNotified += 1;
        continue;
      }

      const email = certificate.user.email?.trim();
      if (!email) {
        result.noEmail += 1;
        continue;
      }

      if (opts.dryRun) {
        const existing = await prisma.contact.findUnique({
          where: { email: email.toLowerCase() },
          select: { courseEmailOptOutAt: true },
        });
        if (existing?.courseEmailOptOutAt) result.unsubscribed += 1;
        result.queued += 1;
        continue;
      }

      const contact = await ensureContactForUser(email, certificate.user.name, {
        source: CERTIFICATE_NOTIFY_SOURCE,
        tags: [cohortTag(cohort)],
        now,
      });
      if (!contact) {
        result.noEmail += 1;
        continue;
      }
      // Course-email opt-outs are still enrolled: only their EMAIL step is skipped.
      if (contact.courseEmailOptOutAt) result.unsubscribed += 1;

      // SQLite's Prisma connector rejects createMany({ skipDuplicates }), so
      // enroll one row at a time and tolerate only a duplicate-key collision:
      // that means the contact is already enrolled and the mail is already on
      // its way, which is exactly the outcome this step wants.
      try {
        await prisma.dripEnrollment.create({
          data: {
            campaignId: campaign.id,
            contactId: contact.id,
            cohortId,
            status: "ACTIVE",
            lastStepOrder: 0,
            nextRunAt: now,
          },
        });
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error;
      }
      await prisma.certificate.update({
        where: { id: certificate.id },
        data: { notifiedAt: now },
      });
      result.queued += 1;
    }

    return result;
  } catch (error) {
    throw new Error(`Failed to enroll certificate notifications for cohort ${cohortId}`, {
      cause: error,
    });
  }
}

export async function certificateMergeContext(
  contact: { email: string; userId?: string | null },
  cohortId: string,
  baseAppUrl: string
): Promise<{
  certificateId: string;
  certificateUrl: string;
  certificatePdfUrl: string;
  certificatePngUrl: string;
  linkedinAddUrl: string;
}> {
  const empty = {
    certificateId: "",
    certificateUrl: "",
    certificatePdfUrl: "",
    certificatePngUrl: "",
    linkedinAddUrl: "",
  };

  try {
    let userId = contact.userId ?? null;
    if (!userId) {
      const user = await prisma.user.findUnique({
        where: { email: contact.email.trim().toLowerCase() },
        select: { id: true },
      });
      userId = user?.id ?? null;
    }
    if (!userId) return empty;

    const certificate = await prisma.certificate.findFirst({
      where: { userId, cohortId, isRevoked: false },
      orderBy: { issuedAt: "desc" },
      select: {
        id: true,
        cohort: { select: { title: true } },
      },
    });
    if (!certificate) return empty;

    const root = baseAppUrl.replace(/\/$/, "");
    const certificateUrl = `${root}/verify?id=${encodeURIComponent(certificate.id)}`;
    const certificatePdfUrl = `${root}/api/certificates/${encodeURIComponent(certificate.id)}/download?format=pdf`;
    const certificatePngUrl = `${root}/api/certificates/${encodeURIComponent(certificate.id)}/download?format=png`;
    const linkedinParams = [
      ["startTask", "CERTIFICATION_NAME"],
      ["name", certificate.cohort.title],
      ["organizationName", brand.name],
      ["issueYear", ""],
      ["issueMonth", ""],
      ["certId", certificate.id],
      ["certUrl", certificateUrl],
    ] as const;
    const linkedinAddUrl = `https://www.linkedin.com/profile/add?${linkedinParams
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&")}`;

    return {
      certificateId: certificate.id,
      certificateUrl,
      certificatePdfUrl,
      certificatePngUrl,
      linkedinAddUrl,
    };
  } catch (error) {
    throw new Error(`Failed to build certificate merge context for cohort ${cohortId}`, {
      cause: error,
    });
  }
}
