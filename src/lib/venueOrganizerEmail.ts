// src/lib/venueOrganizerEmail.ts
//
// Composes the organizer-facing email for a venue rental: warm founder voice,
// agreement signing link + payment link, plain text. Nothing here sends —
// the admin drawer surfaces the result as an editable draft with an
// "Open in Gmail" deep link for a staff member to send from their own account.

import { brand, brandStreetCity } from "@/config/brand";

export interface OrganizerEmailEvent {
  title: string;
  organizerName: string;
  contactEmail: string;
  date: string; // ISO string
  startTime: string;
  endTime: string;
  quoteAmountCents: number | null;
  rentalFeeCents: number | null;
  rentalPaymentUrl: string | null;
  rentalPaymentStatus: string | null;
  latestAgreement: { token: string; status: string } | null;
}

export interface OrganizerEmail {
  to: string;
  subject: string;
  body: string;
  gmailUrl: string;
  warnings: string[];
}

const VENUE_LINE = `${brand.name}, ${brandStreetCity}`;
const AGREEMENTS_BASE = `${brand.urls.hub}/agreements`;

/**
 * Gmail's compose deep link truncates very long URLs; keeping the body under
 * this budget keeps the encoded URL comfortably inside every documented limit.
 */
export const BODY_CHAR_BUDGET = 1400;

function firstName(organizerName: string): string {
  return organizerName.trim().split(/\s+/)[0] || "there";
}

function formatDollars(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

function formatEventDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatSubjectDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

export function buildGmailComposeUrl(to: string, subject: string, body: string): string {
  const params = new URLSearchParams({ view: "cm", fs: "1", to, su: subject, body });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function buildOrganizerEmail(event: OrganizerEmailEvent): OrganizerEmail {
  const warnings: string[] = [];

  const agreement = event.latestAgreement;
  const agreementSigned = agreement?.status === "SIGNED";
  const signingUrl = agreement ? `${AGREEMENTS_BASE}/${agreement.token}` : null;
  if (!agreement) warnings.push("No agreement exists yet — create one first, or remove that part of the email.");

  const paid = event.rentalPaymentStatus === "paid";
  const paymentUrl = !paid ? event.rentalPaymentUrl : null;
  if (!event.rentalPaymentUrl && !paid) {
    warnings.push("No payment link yet — create one first, or send it separately.");
  }

  const priceCents = event.rentalFeeCents ?? event.quoteAmountCents;
  const when = `${formatEventDate(event.date)}, ${event.startTime}–${event.endTime}`;

  const paragraphs: string[] = [];
  paragraphs.push(`Hi ${firstName(event.organizerName)},`);

  const priceClause = priceCents != null ? ` at ${formatDollars(priceCents)} flat` : "";
  paragraphs.push(
    `Great news — you're all set for ${when} at ${VENUE_LINE}${priceClause}. Excited to host ${event.title} here.`
  );

  if (signingUrl && !agreementSigned) {
    paragraphs.push(`Here's the rental agreement to review and sign (takes a minute, all electronic):\n${signingUrl}`);
  } else if (agreementSigned) {
    paragraphs.push(`The agreement is signed — thank you for turning it around quickly.`);
  }

  if (paymentUrl) {
    paragraphs.push(`And here's the payment link:\n${paymentUrl}`);
  } else if (paid) {
    paragraphs.push(`Payment is received — you're fully confirmed.`);
  }

  const nextSteps: string[] = [];
  if (signingUrl && !agreementSigned) nextSteps.push("you sign");
  if (paymentUrl) nextSteps.push("payment comes through");
  if (nextSteps.length > 0) {
    paragraphs.push(
      `Once ${nextSteps.join(" and ")}, I'll confirm the booking and you'll get a calendar invite. If anything about the setup needs discussing before then, just reply here.`
    );
  } else {
    paragraphs.push(`If anything about the setup needs discussing, just reply here.`);
  }

  paragraphs.push(`Looking forward to it,\n${brand.founderFirstName}`);

  const subject = `Your ${formatSubjectDate(event.date)} rental at ${brand.name}`;
  const body = paragraphs.join("\n\n");

  return {
    to: event.contactEmail,
    subject,
    body,
    gmailUrl: buildGmailComposeUrl(event.contactEmail, subject, body),
    warnings,
  };
}
