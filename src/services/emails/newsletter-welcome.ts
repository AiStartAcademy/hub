// src/services/emails/newsletter-welcome.ts
//
// The one transactional email a newsletter subscriber gets immediately. It is
// deliberately transactional (confirming an action they just took) rather than
// a drip step: the `newsletter-welcome` campaign carries the nurture, and its
// first step can be delayed without leaving the signup unacknowledged.
import { brand } from "@/config/brand";
import { escapeHtml, sendMail } from "@/lib/mail";
import { DRIP_FROM, DRIP_REPLY_TO } from "@/lib/drip/template";

const UNSUBSCRIBE_NOTE =
  "Every email we send carries an unsubscribe link. One click, no questions.";

export async function sendNewsletterWelcomeEmail(input: {
  to: string;
  name: string | null;
}): Promise<void> {
  const greeting = input.name ? `Hi ${escapeHtml(input.name)},` : "Hi,";

  await sendMail({
    to: input.to,
    from: DRIP_FROM,
    replyTo: DRIP_REPLY_TO,
    subject: "You're on the list",
    html: [
      `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1B1F3B;line-height:1.55">`,
      `<p style="margin:0 0 16px">${greeting}</p>`,
      `<p style="margin:0 0 16px">You're subscribed to updates from ${brand.name}. We'll send what we're learning building and shipping AI systems — what's working, what quietly isn't, and what's worth your attention.</p>`,
      `<p style="margin:0 0 16px">No fixed schedule. We write when there's something worth the interruption.</p>`,
      `<p style="margin:0 0 16px">If you ever want to reach us, just reply to this email — it comes straight to us.</p>`,
      `<p style="margin:0 0 16px">— The ${brand.name} team</p>`,
      `<hr style="border:none;border-top:1px solid #eaeaea;margin:24px 0" />`,
      `<p style="margin:0;font-size:12px;color:#8a8fa3">${UNSUBSCRIBE_NOTE}</p>`,
      `</div>`,
    ].join(""),
  });
}
