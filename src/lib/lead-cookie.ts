export const LEAD_EMAIL_COOKIE = "lms_contact_email";
export const LEAD_NAME_COOKIE = "lms_contact_name";

export const leadCookieOptions = {
  maxAge: 60 * 60 * 24 * 60,
  // This stays client-readable because LessonViewer checks it in document.cookie.
  httpOnly: false,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

// These cookies are client-writable, so they may only identify an anonymous lead
// and must never be trusted to mutate an existing account.
function readCookieValue(cookieSource: string, cookieName: string): string | null {
  const match = cookieSource.match(
    new RegExp(`(?:^|; )${cookieName.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&")}=([^;]*)`)
  );
  if (!match) return null;

  try {
    const value = decodeURIComponent(match[1]).trim();
    return value || null;
  } catch {
    return null;
  }
}

export function readLeadEmailCookie(cookieSource: string): string | null {
  return readCookieValue(cookieSource, LEAD_EMAIL_COOKIE);
}

export function readLeadNameCookie(cookieSource: string): string | null {
  return readCookieValue(cookieSource, LEAD_NAME_COOKIE);
}
