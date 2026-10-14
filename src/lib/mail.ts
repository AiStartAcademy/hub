// src/lib/mail.ts

import nodemailer from "nodemailer";
import type { SendMailOptions, Transporter } from "nodemailer";
import { brand } from "@/config/brand";
import { content } from "@/config/content";
import { logger } from "./logger";
import { htmlToText } from "./mailText";
import { getSecret } from "@/lib/secrets";
import { isHttpUrl } from "@/lib/sessionLink";

const domain = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
};

/**
 * Read SMTP settings from the managed integrations store, falling back to
 * process.env (getSecret's own fallback). Returns null when no host is
 * configured, which every send path treats as "log, don't send".
 *
 * Resolved per send rather than at module load so a key saved in
 * /admin/integrations takes effect without a redeploy.
 */
async function smtpConfig(): Promise<SmtpConfig | null> {
  const host = (await getSecret("SMTP_HOST"))?.trim();
  if (!host) return null;

  const port = Number.parseInt((await getSecret("SMTP_PORT"))?.trim() || "587", 10);
  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    // Implicit TLS on 465; STARTTLS everywhere else unless explicitly forced.
    secure:
      ((await getSecret("SMTP_SECURE"))?.trim() || "").toLowerCase() === "true" || port === 465,
    user: (await getSecret("SMTP_USER"))?.trim() || undefined,
    pass: (await getSecret("SMTP_PASS"))?.trim() || undefined,
  };
}

let cached: { key: string; transporter: Transporter } | null = null;

async function getTransporter(): Promise<Transporter | null> {
  const config = await smtpConfig();
  if (!config) return null;

  const key = JSON.stringify(config);
  if (cached?.key !== key) {
    cached = {
      key,
      transporter: nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user ? { user: config.user, pass: config.pass } : undefined,
        // Fail fast timeouts to prevent UI hanging
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      }),
    };
  }
  return cached.transporter;
}

async function sendWithValidatedResponse(
  transporter: Transporter,
  options: SendMailOptions,
): Promise<void> {
  const result: unknown = await transporter.sendMail(options);
  if (typeof result !== "object" || result === null) {
    throw new Error("SMTP send returned an invalid response");
  }

  const response = result as Record<string, unknown>;
  if (!Array.isArray(response.accepted) || !Array.isArray(response.rejected)) {
    throw new Error("SMTP send response did not include accepted and rejected recipient lists");
  }
  if (response.accepted.length === 0 || response.rejected.length > 0) {
    const detail = typeof response.response === "string" ? `: ${response.response}` : "";
    throw new Error(`SMTP did not accept every recipient${detail}`);
  }
}

/** True when a host is configured — for health/status endpoints. */
export async function isMailConfigured(): Promise<boolean> {
  return (await smtpConfig()) !== null;
}

const FROM_NAME = brand.email.fromName;
const FALLBACK_FROM = "onboarding@example.com";

/**
 * Build an RFC-5322 `From` header, consistently for every email we send.
 *
 * `MAIL_FROM` may be configured either as a bare address (`hello@example.com`)
 * or as an already-formatted mailbox (`"Name" <hello@example.com>`) — don't
 * double-wrap the latter.
 *
 * Previously this combined the academy display name with `process.env.MAIL_FROM`
 * before applying the fallback.
 * which had two bugs: the `||` fallback was unreachable (a template literal is
 * always truthy, so an unset MAIL_FROM produced the literal string
 * a display name followed by `undefined`), and the address was missing angle brackets,
 * which providers may reject or mangle.
 */
export function fromHeader(override?: string): string {
  const configured = (override || process.env.MAIL_FROM || "").trim();
  if (!configured) return `"${FROM_NAME}" <${FALLBACK_FROM}>`;
  // Already a full mailbox (has a display name and/or angle brackets) — use as-is.
  if (configured.includes("<")) return configured;
  return `"${FROM_NAME}" <${configured}>`;
}

/** `fromHeader`, but reading the managed `MAIL_FROM` key when no override is given. */
async function resolveFrom(override?: string): Promise<string> {
  return fromHeader(override?.trim() || (await getSecret("MAIL_FROM")));
}

export const sendVerificationEmail = async (
  email: string,
  token: string,
  redirect?: { callbackUrl?: string; groupId?: string }
) => {
  const params = new URLSearchParams({ token });
  if (redirect?.callbackUrl) params.set("callbackUrl", redirect.callbackUrl);
  if (redirect?.groupId) params.set("groupId", redirect.groupId);
  const confirmLink = `${domain}/verify-email?${params.toString()}`;

  const transporter = await getTransporter();
  if (!transporter) {
    logger.info("----------------NO SMTP HOST-------------------------");
    logger.info(`To: ${email}`);
    logger.info(`Subject: Confirm your email`);
    logger.info(`Link: ${confirmLink}`);
    logger.info("-----------------------------------------");
    return;
  }

  await sendWithValidatedResponse(transporter, {
    from: await resolveFrom(),
    to: email,
    subject: "Confirm your email address",
    text: [
      "Confirm your email",
      "",
      "Thank you for registering! Open the link below to verify your email address and activate your account.",
      "",
      confirmLink,
      "",
      "This verification link will expire in 24 hours.",
      "If you didn't create an account, you can safely ignore and delete this email.",
    ].join("\n"),
    html: `
<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Confirm your email</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f7fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        
        <div style="display: none; max-height: 0px; overflow: hidden;">
          Please verify your email address to complete your registration.
        </div>

        <div style="max-width: 600px; margin: 40px auto; padding: 40px 30px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
          
          <h2 style="color: #1a202c; margin-top: 0; margin-bottom: 24px; font-size: 24px;">Confirm your email</h2>
          
          <p style="color: #4a5568; line-height: 1.6; margin-bottom: 32px; font-size: 16px;">
            Thank you for registering! Please click the button below to verify your email address and activate your account.
          </p>
          
          <div style="text-align: center; margin-bottom: 32px;">
            <a href="${confirmLink}" style="display: inline-block; background-color: #3182ce; color: #ffffff; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">
              Verify my email
            </a>
          </div>
          
          <!-- Fallback link, muted so its length doesn't dominate the message. -->
          <p style="color: #a0aec0; font-size: 13px; margin-bottom: 4px; line-height: 1.5;">
            Or copy and paste this link into your browser:
          </p>
          <div style="background-color: #f7fafc; padding: 12px; border-radius: 4px; border: 1px solid #edf2f7; margin-bottom: 32px;">
             <!-- word-break: break-all keeps a long token from breaking the layout. -->
             <a href="${confirmLink}" style="color: #718096; font-size: 13px; text-decoration: underline; word-break: break-all;">
               ${confirmLink}
             </a>
          </div>

          <hr style="border: none; border-top: 1px solid #e2e8f0; margin-bottom: 24px;" />

          <p style="color: #a0aec0; font-size: 12px; margin-bottom: 12px; text-align: center;">
            This verification link will expire in 24 hours.
          </p>

          <!-- "Didn't register?" reassurance block. -->
          <p style="color: #a0aec0; font-size: 12px; margin-top: 0; text-align: center; line-height: 1.5;">
            <strong>Didn't register?</strong> If you didn't create an account, you can safely ignore and delete this email.
          </p>

        </div>
      </body>
      </html>
    `,
  });
};


export const sendMail = async (options: {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  /**
   * Plain-text alternative part. Omit it and one is derived from `html` —
   * HTML-only mail is a strong spam signal, so every send gets a text part.
   */
  text?: string;
  /**
   * Extra RFC-5322 headers. Nurture mail passes `List-Unsubscribe` /
   * `List-Unsubscribe-Post` here (see `unsubscribeHeaders` in drip/engine.ts);
   * transactional mail deliberately does not.
   */
  headers?: Record<string, string>;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType: string;
  }>;
}) => {
  const transporter = await getTransporter();
  if (!transporter) {
    logger.info("-----------------------------------------");
    logger.info(`[sendMail] To: ${options.to}`);
    logger.info(`[sendMail] Subject: ${options.subject}`);
    logger.info(`[sendMail] From: ${await resolveFrom(options.from)}`);
    logger.info("-----------------------------------------");
    return;
  }

  await sendWithValidatedResponse(transporter, {
    from: await resolveFrom(options.from),
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text?.trim() || htmlToText(options.html),
    replyTo: options.replyTo,
    headers: options.headers,
    attachments: options.attachments,
  });
};

export const escapeHtml = (value: string) =>
  value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);

export const sendInviteEmail = async (
  email: string,
  token: string,
  roleLabel: string = "Student"
) => {
  // Uses your existing setup password flow
  const setupLink = `${domain}/set-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

  await sendMail({
    to: email,
    subject: `You have been invited to join as a ${roleLabel}`,
    html: `
      <div style="max-width:600px;margin:40px auto;padding:32px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a202c">
        <h2 style="margin:0 0 16px;font-size:24px">Welcome to ${brand.name}</h2>
        <p style="line-height:1.6;color:#4a5568">
          You have been invited to join our platform as a <strong>${escapeHtml(roleLabel)}</strong>.
        </p>
        <div style="text-align:center;margin:28px 0">
          <a href="${setupLink}" style="display:inline-block;background:#3182ce;color:#ffffff;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:600">
            Accept Invitation & Setup Account
          </a>
        </div>
        <p style="font-size:13px;color:#718096;line-height:1.5">
          If you already have an account attached to this email, please ignore this link and sign in directly.
        </p>
      </div>
    `,
  });
};

/** The one place the set-password link is built, so every mail that sends one agrees. */
export const accountSetupUrl = (token: string) =>
  `${domain}/set-password?token=${encodeURIComponent(token)}`;

export const sendAccountSetupEmail = async (
  email: string,
  token: string,
  cohortTitle: string
) => {
  const setupLink = accountSetupUrl(token);
  const safeTitle = escapeHtml(cohortTitle);

  await sendMail({
    to: email,
    subject: `Set up your ${brand.name} account`,
    html: `
      <div style="max-width:600px;margin:40px auto;padding:32px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a202c">
        <h2 style="margin:0 0 16px;font-size:24px">Your seat is confirmed</h2>
        <p style="line-height:1.6;color:#4a5568">
          Your payment for <strong>${safeTitle}</strong> was received. Set a password to access your cohort workspace.
        </p>
        <p style="line-height:1.6;color:#4a5568">
          After that we will ask you to read and accept a few program policies — how we handle
          your data, how we treat each other in the room, and what happens with the session
          recordings. It takes a few minutes and you only do it once.
        </p>
        <div style="text-align:center;margin:28px 0">
          <a href="${setupLink}" style="display:inline-block;background:#3182ce;color:#ffffff;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:600">
            Set up my account
          </a>
        </div>
        <p style="font-size:13px;color:#718096;line-height:1.5">
          This one-time link expires in one hour. If you already use ${brand.name} with this email, sign in normally instead.
        </p>
      </div>
    `,
  });
};

export function buildSelfPacedWelcomeEmail(
  name: string | null,
  programId: string,
  programName: string = content.selfPacedProgram.name,
): { subject: string; html: string } {
  const firstName = escapeHtml((name ?? "").split(" ")[0] || "there");
  const courseUrl = `${domain}/courses/${programId}`;
  const safeProgramName = escapeHtml(programName);

  return {
    subject: `Welcome to the ${programName}`,
    html: `
      <div style="max-width:600px;margin:40px auto;padding:32px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a202c">
        <h2 style="margin:0 0 16px;font-size:24px">Welcome, ${firstName}</h2>
        <p style="line-height:1.6;color:#4a5568">
          You're in the <strong>${safeProgramName}</strong>. Start with session 1 and work through the builds at your own pace.
        </p>
        <div style="text-align:center;margin:28px 0">
          <a href="${courseUrl}" style="display:inline-block;background:#3182ce;color:#ffffff;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:600">
            Start session 1
          </a>
        </div>
        <p style="line-height:1.6;color:#4a5568">
          The 21-chapter workbook is in the <strong>Materials</strong> section on the course page.
        </p>
        <p style="line-height:1.6;color:#4a5568">
          For your first 90 days, bring questions and blockers to the weekly check-in call on <strong>Wednesdays at 6pm PT</strong>. You'll find the call details in the <a href="${domain}/members/calls" style="color:#3182ce">members area</a>.
        </p>
        <p style="font-size:13px;color:#718096;line-height:1.5">
          You have 7 days to make sure the course fits what you need. If it doesn't, email <a href="mailto:${brand.email.contact}" style="color:#3182ce">${brand.email.contact}</a> for a full refund.
        </p>
      </div>
    `,
  };
}

export const sendSelfPacedWelcomeEmail = async (
  email: string,
  name: string | null,
  programId: string
) => {
  const message = buildSelfPacedWelcomeEmail(name, programId);
  await sendMail({ to: email, ...message });
};

export const sendGroupInviteEmail = async (
  email: string,
  token: string,
  context: { cohortTitle: string; groupName: string; cohortId: string }
) => {
  const setupLink = `${domain}/set-password?token=${encodeURIComponent(token)}`;
  const cohortPath = `/cohorts/${encodeURIComponent(context.cohortId)}`;
  const loginLink = `${domain}/login?callbackUrl=${encodeURIComponent(cohortPath)}`;
  const displayedLoginLink = `${domain}/login`;
  const safeCohortTitle = escapeHtml(context.cohortTitle);
  const safeGroupName = escapeHtml(context.groupName);

  const transporter = await getTransporter();
  if (!transporter) {
    logger.info("----------------NO SMTP HOST-------------------------");
    logger.info(`To: ${email}`);
    logger.info(`Subject: You're invited to ${context.cohortTitle}`);
    logger.info(`Link: ${setupLink}`);
    logger.info("-----------------------------------------");
    return;
  }

  await sendMail({
    to: email,
    subject: `You're invited to ${context.cohortTitle}`,
    html: `
      <div style="max-width:600px;margin:40px auto;padding:32px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1B1F3B">
        <h2 style="margin:0 0 16px;font-size:24px;color:#1B1F3B">Join ${safeCohortTitle}</h2>
        <p style="line-height:1.6;color:#4a5568">
          You have been added to <strong>${safeGroupName}</strong>. Set a password to finish setting up your ${brand.name} account.
        </p>
        <div style="text-align:center;margin:28px 0">
          <a href="${setupLink}" style="display:inline-block;background:#1B1F3B;color:#56E9EB;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:600">
            Set up my account
          </a>
        </div>
        <p style="font-size:13px;color:#718096;line-height:1.5">
          This one-time link expires in seven days.
        </p>
        <p style="font-size:13px;color:#718096;line-height:1.5">
          Prefer Google? Sign in at <a href="${loginLink}" style="color:#1B1F3B">${escapeHtml(displayedLoginLink)}</a>.
        </p>
      </div>
    `,
  });
};

// ─── Free-seat registration ────────────────────────────────────────────────

export type FreeSeatEmailInput = {
  name: string | null;
  cohortTitle: string;
  /** "09 SEP 2026 · 18:00 PDT", or null when nothing is upcoming. */
  whenLine: string | null;
  /** Resolved join link for that session, or null when there is none yet. */
  joinLink: string | null;
  /** Present only for an account that has no password yet. */
  setupToken?: string | null;
  cohortUrl: string;
};

/**
 * The confirmation a free registrant gets. Pure so the copy can be asserted
 * without SMTP; sendFreeSeatEmail is the thin wrapper that actually mails it.
 *
 * Every interpolated value is escaped: `name` and `cohortTitle` are attacker- and
 * admin-supplied respectively, and the previous version of this mail interpolated
 * the raw name straight into the markup.
 */
export const renderFreeSeatEmail = (
  input: FreeSeatEmailInput
): { subject: string; html: string } => {
  const firstName = escapeHtml((input.name ?? "").trim().split(" ")[0] || "there");
  const safeTitle = escapeHtml(input.cohortTitle);

  const whenBlock = input.whenLine
    ? `<p style="line-height:1.6;color:#4a5568">Next session: <strong>${escapeHtml(
        input.whenLine
      )}</strong></p>`
    : "";

  // Only http(s) links become anchors — a legacy row holding `javascript:` or a
  // bare hostname must degrade to the promise line, never to a live href.
  const hasUsableLink = isHttpUrl(input.joinLink);
  const safeJoinLink = hasUsableLink ? escapeHtml(input.joinLink as string) : "";
  const joinBlock = hasUsableLink
    ? `<div style="text-align:center;margin:28px 0">
        <a href="${safeJoinLink}" style="display:inline-block;background:#3182ce;color:#ffffff;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          Join the session
        </a>
      </div>
      <p style="font-size:13px;color:#718096;line-height:1.5;word-break:break-all">${safeJoinLink}</p>`
    : `<p style="line-height:1.6;color:#4a5568">We'll email you the join link before the session.</p>`;

  const setupBlock = input.setupToken
    ? `<hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0" />
      <p style="line-height:1.6;color:#4a5568">
        We created an account for <strong>${escapeHtml(
          input.cohortTitle
        )}</strong> materials and recordings. Set a password to open it.
      </p>
      <div style="text-align:center;margin:20px 0">
        <a href="${escapeHtml(
          accountSetupUrl(input.setupToken)
        )}" style="display:inline-block;background:#1a202c;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">
          Set up your account
        </a>
      </div>
      <p style="font-size:13px;color:#718096;line-height:1.5">
        This link works for 7 days. After that, register again to get a new one, or sign in with Google using this same address.
      </p>`
    : "";

  return {
    subject: `You're registered — ${input.cohortTitle}`,
    html: `
      <div style="max-width:600px;margin:40px auto;padding:32px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a202c">
        <h2 style="margin:0 0 16px;font-size:24px">Hi ${firstName}, you're in</h2>
        <p style="line-height:1.6;color:#4a5568">
          You're registered for <strong>${safeTitle}</strong>.
        </p>
        ${whenBlock}
        ${joinBlock}
        <p style="line-height:1.6;color:#4a5568">
          Details and the full schedule: <a href="${escapeHtml(input.cohortUrl)}">${escapeHtml(
            input.cohortUrl
          )}</a>
        </p>
        ${setupBlock}
        <p style="line-height:1.6;color:#4a5568">— ${brand.name}</p>
      </div>
    `,
  };
};

export const sendFreeSeatEmail = async (
  input: FreeSeatEmailInput & { to: string }
): Promise<void> => {
  const { subject, html } = renderFreeSeatEmail(input);
  await sendMail({ to: input.to, subject, html });
};
