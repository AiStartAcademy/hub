// src/lib/certificateBrandPlaceholders.ts
//
// Certificate HTML templates (certificate-templates/*.html, uploaded to GCS)
// cannot import TypeScript, so they carry placeholders that are filled here
// from the brand and content configs at render time.
import { brand } from "@/config/brand";
import { content } from "@/config/content";

export interface CertificatePlaceholderValues {
  academyName: string;
  logoText: string;
  logoImage: string;
  signatureImage: string;
  signatureText: string;
  signerName: string;
  signerTitle: string;
  siteUrl: string;
  siteDomain: string;
  hubUrl: string;
  programDescription: string;
  competencies: readonly string[];
  location: string;
}

export const CERTIFICATE_PLACEHOLDER_VALUES: CertificatePlaceholderValues = Object.freeze({
  academyName: brand.name,
  logoText: brand.certificate.logoText,
  logoImage: brand.certificate.logoImage,
  signatureImage: brand.certificate.signatureImage,
  signatureText: brand.certificate.signatureText,
  signerName: brand.signer.name,
  signerTitle: brand.signer.title,
  siteUrl: brand.urls.site,
  siteDomain: brand.domains.site,
  hubUrl: brand.urls.hub,
  programDescription: content.certificate.programDescription,
  competencies: content.certificate.competencies,
  location: content.certificate.location,
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function replaceOptionalBlock(
  html: string,
  name: string,
  enabled: boolean,
): string {
  const startToken = `{{${name}_BLOCK_START}}`;
  const endToken = `{{${name}_BLOCK_END}}`;
  const startCount = html.split(startToken).length - 1;
  const endCount = html.split(endToken).length - 1;
  if (startCount !== endCount) {
    throw new Error(`Certificate template has unmatched ${name} block markers`);
  }

  let rendered = html;
  while (rendered.includes(startToken)) {
    const start = rendered.indexOf(startToken);
    const end = rendered.indexOf(endToken, start + startToken.length);
    if (end < 0) {
      throw new Error(`Certificate template has unmatched ${name} block markers`);
    }
    const inner = rendered.slice(start + startToken.length, end);
    rendered =
      rendered.slice(0, start) +
      (enabled ? inner : "") +
      rendered.slice(end + endToken.length);
  }
  return rendered;
}

function replacements(values: CertificatePlaceholderValues): Readonly<Record<string, string>> {
  const academyName = escapeHtml(values.academyName);
  return {
    ACADEMY_NAME: academyName,
    SIGNER_NAME: escapeHtml(values.signerName),
    SIGNER_TITLE: escapeHtml(values.signerTitle),
    SITE_URL: escapeHtml(values.siteUrl),
    SITE_DOMAIN: escapeHtml(values.siteDomain),
    HUB_URL: escapeHtml(values.hubUrl),
    CERTIFICATE_LOGO_TEXT: escapeHtml(values.logoText),
    CERTIFICATE_SIGNATURE_TEXT: values.signatureText
      ? `<div class="signature-draw">${escapeHtml(values.signatureText)}</div>`
      : "",
    CERTIFICATE_LOGO_IMAGE: values.logoImage
      ? `<img class="logo-img" src="${escapeHtml(values.logoImage)}" alt="${academyName} Logo" />`
      : "",
    CERTIFICATE_SIGNATURE_IMAGE: values.signatureImage
      ? `<img class="sig-img" src="${escapeHtml(values.signatureImage)}" alt="Signature" />`
      : "",
    CERTIFICATE_PROGRAM_DESCRIPTION_BLOCK: values.programDescription
      ? `<div class="course-desc">${escapeHtml(values.programDescription)}</div>`
      : "",
    CERTIFICATE_COMPETENCIES: values.competencies
      .map((competency) => `<li>${escapeHtml(competency)}</li>`)
      .join("\n"),
    CERTIFICATE_LOCATION_BLOCK: values.location
      ? `<div>Location: ${escapeHtml(values.location)}</div>`
      : "",
  };
}

/** Replace every certificate config placeholder while leaving student data placeholders for the route. */
export function fillCertificateBrandPlaceholders(
  html: string,
  values: CertificatePlaceholderValues = CERTIFICATE_PLACEHOLDER_VALUES,
): string {
  let filled = replaceOptionalBlock(
    html,
    "CERTIFICATE_COMPETENCIES",
    values.competencies.length > 0,
  );
  for (const [key, value] of Object.entries(replacements(values))) {
    filled = filled.split(`{{${key}}}`).join(value);
  }
  const unknown = filled.match(/{{CERTIFICATE_[A-Z_]+}}/);
  if (unknown) {
    throw new Error(`Unknown certificate placeholder ${unknown[0]}`);
  }
  return filled;
}
