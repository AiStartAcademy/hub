export type SmsRenderContext = {
  firstName?: string | null;
  name?: string | null;
  bookingUrl?: string | null;
  certificateUrl?: string | null;
  cohortName?: string | null;
};

export function renderSmsBody(body: string, ctx: SmsRenderContext): string {
  const name = ctx.name?.trim() ?? "";
  const firstName = ctx.firstName?.trim() || name.split(/\s+/)[0] || "";
  // Booking URLs are not resolved per contact yet, so this token intentionally renders empty.
  const rendered = body
    .replace(/\{\{first_name\}\}/g, firstName)
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{booking_url\}\}/g, "")
    .replace(/\{\{certificate_url\}\}/g, ctx.certificateUrl?.trim() ?? "")
    .replace(/\{\{cohort_name\}\}/g, ctx.cohortName?.trim() ?? "")
    // Drop any token this renderer does not know. SMS has no shell to sanitize
    // it later, so an unsupported token would otherwise be texted verbatim —
    // which is exactly how "{{cohort_name}}" nearly went out to graduates.
    .replace(/\{\{\s*[a-z_]+\s*\}\}/gi, "")
    // Collapse runs of spaces but keep line breaks — staff-typed multi-line
    // messages should arrive with their formatting.
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return rendered.slice(0, 640).trim();
}
