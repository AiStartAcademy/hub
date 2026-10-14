import { sendMail } from "@/lib/mail";

export const sendLeadMagnetEmail = async (
  to: string,
  name: string,
  mediaName: string,
  downloadUrl: string
) => {
  const subject = `Your download is ready: ${mediaName}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <h2 style="color: #2563eb;">Hello, ${name}!</h2>
      <p>Thank you for your interest. Your material <strong>"${mediaName}"</strong> is ready and available at the link below.</p>
      
      <div style="text-align: center; margin: 35px 0;">
        <a href="${downloadUrl}" style="background-color: #2563eb; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 16px;">
          Download Material
        </a>
      </div>
      
      <p style="font-size: 14px; color: #666; line-height: 1.5;">
        <em>Please note:</em> For security reasons, this secure link will expire in 24 hours.
      </p>
      
      <hr style="border: none; border-top: 1px solid #eaeaea; margin: 25px 0;" />
      <p style="font-size: 12px; color: #999;">
        If you did not request this file, please ignore this email.
      </p>
    </div>
  `;

  await sendMail({
    to,
    subject,
    html,
  });
};