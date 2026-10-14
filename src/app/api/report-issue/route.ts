import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sendMail } from "@/lib/mail";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { type, description, currentUrl } = body as {
      type?: string;
      description?: string;
      currentUrl?: string;
    };

    if (!type || !description || description.trim().length < 5) {
      return NextResponse.json(
        { error: "Type and description (min 5 chars) are required" },
        { status: 400 }
      );
    }

    const userName = session.user.name || "Unknown";
    const userEmail = session.user.email || "no-reply";

    const subject = `[LMS Issue] ${type} — ${userName}`;
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #1a202c; margin-bottom: 24px;">New Issue Report</h2>
        <p style="color: #4a5568; line-height: 1.6;"><strong>User:</strong> ${userName} &lt;${userEmail}&gt;</p>
        <p style="color: #4a5568; line-height: 1.6;"><strong>Type:</strong> ${type}</p>
        <p style="color: #4a5568; line-height: 1.6;"><strong>Page:</strong> ${currentUrl || "N/A"}</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #4a5568; line-height: 1.6;"><strong>Description:</strong></p>
        <p style="color: #4a5568; line-height: 1.6; white-space: pre-wrap;">${description.replace(/</g, "&lt;")}</p>
      </div>
    `;

    await sendMail({
      to: process.env.REPORT_ISSUE_EMAIL || process.env.MAIL_FROM || "support@example.com",
      subject,
      html,
      replyTo: userEmail,
    });

    logger.info(`[report-issue] Sent by ${userEmail} | Type: ${type}`);

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error({ err: err }, "[report-issue] Failed to send:");
    return NextResponse.json({ error: "Failed to send report" }, { status: 500 });
  }
}