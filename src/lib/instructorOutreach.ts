// src/lib/instructorOutreach.ts
// Renders and sends instructor participation-confirmation emails.
//
// Deliberately NOT the Contact drip engine (no enrollment/scheduling semantics):
// an InstructorOutreach row is a one-shot, per-cohort cycle that must be APPROVED
// by a human before sendOutreach() will touch it. This is operational mail to
// staff, so there is no unsubscribe footer — the footer states why they got it.
//
// Merge tokens (staff-authored HTML body, values escaped):
//   {{first_name}} {{cohort_title}} {{cohort_dates}} {{sessions_html}} {{respond_url}}

import { brand, brandCityAddress } from "@/config/brand";
import prisma from "@/lib/prisma";
import { sendMail, escapeHtml } from "@/lib/mail";
import { logger } from "@/lib/logger";
import { resolveDripSender } from "@/lib/drip/template";

const BRAND_NIGHT = "#1B1F3B";
const BRAND_TEAL = "#56E9EB";
const WORDMARK_BREAK = brand.wordmark.lastIndexOf(" ");
const WORDMARK_PREFIX = brand.wordmark.slice(0, WORDMARK_BREAK + 1);
const WORDMARK_SUFFIX = brand.wordmark.slice(WORDMARK_BREAK + 1);

// Skip recipients emailed for this outreach within this window unless force=true.
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

type SessionLite = { title: string; date: Date; startTime: string; endTime: string; timezone: string };

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

function firstName(name: string | null, fallbackEmail: string): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || fallbackEmail.split("@")[0];
}

function formatDate(d: Date | null): string {
  if (!d) return "TBD";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function sessionsHtml(sessions: SessionLite[], cohortStart: Date | null, cohortEnd: Date | null): string {
  if (!sessions.length) {
    // Degrade to the cohort date range when sessions don't exist yet.
    return `<p style="margin:16px 0">Cohort dates: <strong>${escapeHtml(formatDate(cohortStart))} – ${escapeHtml(formatDate(cohortEnd))}</strong> (day-by-day schedule to follow).</p>`;
  }
  const rows = sessions
    .map(
      (s) => `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${escapeHtml(formatDate(s.date))}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${escapeHtml(s.startTime)}–${escapeHtml(s.endTime)} ${escapeHtml(s.timezone)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${escapeHtml(s.title)}</td>
      </tr>`
    )
    .join("");
  return `<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
    <tr>
      <th style="text-align:left;padding:8px 12px;border-bottom:2px solid ${BRAND_NIGHT}">Date</th>
      <th style="text-align:left;padding:8px 12px;border-bottom:2px solid ${BRAND_NIGHT}">Time</th>
      <th style="text-align:left;padding:8px 12px;border-bottom:2px solid ${BRAND_NIGHT}">Session</th>
    </tr>${rows}</table>`;
}

export function renderInstructorEmail(
  outreach: { subject: string; body: string },
  ctx: {
    instructorName: string | null;
    instructorEmail: string;
    cohortTitle: string;
    cohortStart: Date | null;
    cohortEnd: Date | null;
    sessions: SessionLite[];
    responseToken: string;
    /** v2: prefer the cross-cohort schedule page when the instructor has a token. */
    scheduleToken?: string | null;
  }
): { subject: string; html: string } {
  const respondUrl = instructorLink(ctx.scheduleToken ?? null, ctx.responseToken);
  const values: Record<string, string> = {
    first_name: escapeHtml(firstName(ctx.instructorName, ctx.instructorEmail)),
    cohort_title: escapeHtml(ctx.cohortTitle),
    cohort_dates: escapeHtml(`${formatDate(ctx.cohortStart)} – ${formatDate(ctx.cohortEnd)}`),
    sessions_html: sessionsHtml(ctx.sessions, ctx.cohortStart, ctx.cohortEnd),
    respond_url: respondUrl,
  };
  const merge = (input: string) => input.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => values[key] ?? m);

  const body = merge(outreach.body);
  const subject = merge(outreach.subject)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif">
    <div style="padding:0 8px 16px">
      <span style="font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND_NIGHT}">
        ${WORDMARK_PREFIX}<span style="font-weight:400;text-transform:none;letter-spacing:0">${WORDMARK_SUFFIX}</span>
      </span>
    </div>

    <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:3px solid ${BRAND_TEAL};border-radius:12px;padding:32px;color:#1a202c;font-size:16px;line-height:1.65">
      ${body}
      <div style="text-align:center;margin:32px 0 8px">
        <a href="${respondUrl}"
           style="display:inline-block;background:#7209B7;color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">
          Confirm participation &amp; availability
        </a>
      </div>
    </div>

    <div style="padding:20px 8px;text-align:center;color:#94a3b8;font-size:12px;line-height:1.6">
      <p style="margin:0 0 6px">${brand.name} · ${brandCityAddress}</p>
      <p style="margin:0">You're receiving this because you're assigned to teach ${values.cohort_title}.</p>
    </div>
  </div>
</body></html>`;

  return { subject, html };
}

/** The shared branded shell — one body, one call to action. */
function emailShell(body: string, ctaUrl: string, ctaLabel: string, footerLine: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif">
    <div style="padding:0 8px 16px">
      <span style="font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND_NIGHT}">
        ${WORDMARK_PREFIX}<span style="font-weight:400;text-transform:none;letter-spacing:0">${WORDMARK_SUFFIX}</span>
      </span>
    </div>
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:3px solid ${BRAND_TEAL};border-radius:12px;padding:32px;color:#1a202c;font-size:16px;line-height:1.65">
      ${body}
      <div style="text-align:center;margin:32px 0 8px">
        <a href="${ctaUrl}"
           style="display:inline-block;background:#7209B7;color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">
          ${escapeHtml(ctaLabel)}
        </a>
      </div>
    </div>
    <div style="padding:20px 8px;text-align:center;color:#94a3b8;font-size:12px;line-height:1.6">
      <p style="margin:0 0 6px">${brand.name} · ${brandCityAddress}</p>
      <p style="margin:0">${footerLine}</p>
    </div>
  </div>
</body></html>`;
}

/**
 * Link an instructor to their cross-cohort schedule when they have a token, and fall
 * back to the v1 per-cohort response page when they don't (pre-backfill accounts).
 */
export function instructorLink(scheduleToken: string | null, responseToken: string): string {
  return scheduleToken
    ? `${appUrl()}/instructor-schedule/${scheduleToken}`
    : `${appUrl()}/instructor-response/${responseToken}`;
}

/** Reminder for a schedule proposal nobody has answered yet. */
export function renderNudgeEmail(ctx: {
  instructorName: string | null;
  instructorEmail: string;
  cohortTitle: string;
  cohortStart: Date | null;
  cohortEnd: Date | null;
  scheduleToken: string | null;
  responseToken: string;
  isSecondNudge: boolean;
}): { subject: string; html: string } {
  const name = escapeHtml(firstName(ctx.instructorName, ctx.instructorEmail));
  const title = escapeHtml(ctx.cohortTitle);
  const dates = escapeHtml(`${formatDate(ctx.cohortStart)} – ${formatDate(ctx.cohortEnd)}`);
  const body = ctx.isSecondNudge
    ? `<p>Hi ${name},</p>
       <p>Still hoping to lock the teaching schedule for <strong>${title}</strong> (${dates}). If you can't make these dates, saying so is just as useful as a yes — we'll plan around it.</p>
       <p>This is the last automated reminder; after this we'll follow up personally.</p>`
    : `<p>Hi ${name},</p>
       <p>A quick nudge on <strong>${title}</strong> (${dates}) — we still need your confirmation before the schedule is final.</p>
       <p>It takes a minute: approve the sessions that work, or propose different times.</p>`;
  return {
    subject: `${ctx.isSecondNudge ? "Last reminder" : "Reminder"}: confirm your ${ctx.cohortTitle} schedule`.slice(0, 200),
    html: emailShell(body, instructorLink(ctx.scheduleToken, ctx.responseToken), "Review your schedule", `You're receiving this because you're assigned to teach ${title}.`),
  };
}

/** T-72h / T-24h heads-up before a confirmed class. */
export function renderSessionReminderEmail(ctx: {
  instructorName: string | null;
  instructorEmail: string;
  cohortTitle: string;
  sessionTitle: string;
  startUtc: Date;
  endUtc: Date;
  ianaTz: string;
  location: string | null;
  meetingLink: string | null;
  scheduleToken: string | null;
  hoursAhead: number;
}): { subject: string; html: string } {
  const name = escapeHtml(firstName(ctx.instructorName, ctx.instructorEmail));
  const when = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: ctx.ianaTz,
    timeZoneName: "short",
  }).format(ctx.startUtc);
  const body = `<p>Hi ${name},</p>
    <p>You're teaching <strong>${escapeHtml(ctx.sessionTitle)}</strong> (${escapeHtml(ctx.cohortTitle)}) ${
      ctx.hoursAhead >= 72 ? "in a few days" : "tomorrow"
    }.</p>
    <p><strong>${escapeHtml(when)}</strong></p>
    ${ctx.location ? `<p>Location: ${escapeHtml(ctx.location)}</p>` : ""}
    ${ctx.meetingLink ? `<p>Join link: <a href="${ctx.meetingLink}">${escapeHtml(ctx.meetingLink)}</a></p>` : ""}
    <p>If anything has changed on your side, let us know as soon as you can.</p>`;
  return {
    subject: `${ctx.hoursAhead >= 72 ? "This week" : "Tomorrow"}: ${ctx.sessionTitle} — ${ctx.cohortTitle}`.slice(0, 200),
    html: emailShell(
      body,
      ctx.scheduleToken ? `${appUrl()}/instructor-schedule/${ctx.scheduleToken}` : appUrl(),
      "View your schedule",
      `You're receiving this because you're teaching ${escapeHtml(ctx.cohortTitle)}.`
    ),
  };
}

export type SendOutreachResult = {
  sent: string[]; // instructor emails
  skipped: { email: string; reason: string }[];
  failed: { email: string; error: string }[];
};

/**
 * Send an APPROVED outreach to its cohort's instructors.
 * Default targets: records with status PENDING. `only` narrows to specific
 * CohortInstructor ids (nudge/resend); `force` bypasses the 24h dedupe window.
 */
export async function sendOutreach(
  outreachId: string,
  opts: { only?: string[]; force?: boolean } = {}
): Promise<SendOutreachResult> {
  const outreach = await prisma.instructorOutreach.findUnique({
    where: { id: outreachId },
    include: {
      cohort: {
        select: {
          title: true,
          startDate: true,
          endDate: true,
          sessions: {
            orderBy: [{ date: "asc" }, { order: "asc" }],
            select: { title: true, date: true, startTime: true, endTime: true, timezone: true },
          },
        },
      },
    },
  });
  if (!outreach) throw new Error("Outreach not found");
  if (outreach.status === "DRAFT") throw new Error("Outreach is not approved — approve it before sending");

  const records = await prisma.cohortInstructor.findMany({
    where: {
      cohortId: outreach.cohortId,
      ...(opts.only?.length ? { id: { in: opts.only } } : { status: "PENDING" }),
    },
    include: {
      instructor: { select: { name: true, email: true, scheduleToken: true } },
      outreachSends: { where: { outreachId }, orderBy: { sentAt: "desc" }, take: 1 },
      // Each recipient's own assigned sessions — a guest speaker covering one
      // lesson must not receive a schedule listing the whole cohort.
      assignments: {
        select: {
          session: { select: { title: true, date: true, startTime: true, endTime: true, timezone: true } },
        },
      },
    },
  });

  const result: SendOutreachResult = { sent: [], skipped: [], failed: [] };
  const smtpConfigured = Boolean(process.env.SMTP_HOST);

  for (const record of records) {
    const email = record.instructor.email;
    const lastSend = record.outreachSends[0];
    if (
      !opts.force &&
      lastSend &&
      lastSend.status === "SENT" &&
      Date.now() - lastSend.sentAt.getTime() < DEDUPE_WINDOW_MS
    ) {
      result.skipped.push({ email, reason: "sent within last 24h" });
      continue;
    }

    // Show this person only the sessions they were actually assigned. Falling
    // back to the full cohort when they have no assignments preserves the
    // whole-cohort case (single-instructor bootcamp, or an invite sent before
    // sessions were divided up).
    const ownSessions = record.assignments
      .map((a) => a.session)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const sessionsForEmail = ownSessions.length ? ownSessions : outreach.cohort.sessions;

    const { subject, html } = renderInstructorEmail(outreach, {
      instructorName: record.instructor.name,
      instructorEmail: email,
      cohortTitle: outreach.cohort.title,
      cohortStart: outreach.cohort.startDate,
      cohortEnd: outreach.cohort.endDate,
      sessions: sessionsForEmail,
      responseToken: record.responseToken,
      scheduleToken: record.instructor.scheduleToken,
    });

    try {
      const { from, replyTo } = resolveDripSender();
      await sendMail({ to: email, subject, html, from, replyTo });
      if (!smtpConfigured) {
        // sendMail no-ops to console without SMTP — record truthfully.
        logger.info({ email, respondUrl: `${appUrl()}/instructor-response/${record.responseToken}` }, "[instructorOutreach] SKIPPED (no SMTP)");
        await prisma.instructorOutreachSend.create({
          data: { outreachId, cohortInstructorId: record.id, status: "SKIPPED", error: "SMTP not configured" },
        });
        result.skipped.push({ email, reason: "SMTP not configured (logged to console)" });
      } else {
        await prisma.instructorOutreachSend.create({
          data: { outreachId, cohortInstructorId: record.id, status: "SENT" },
        });
        await prisma.cohortInstructor.update({ where: { id: record.id }, data: { invitedAt: new Date() } });
        result.sent.push(email);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.instructorOutreachSend.create({
        data: { outreachId, cohortInstructorId: record.id, status: "FAILED", error: message },
      });
      result.failed.push({ email, error: message });
      logger.error({ err, email }, "[instructorOutreach] send failed");
    }
  }

  if (result.sent.length || result.skipped.some((s) => s.reason.startsWith("SMTP"))) {
    await prisma.instructorOutreach.update({
      where: { id: outreachId },
      data: { status: "SENT", sentAt: new Date() },
    });
  }

  return result;
}
