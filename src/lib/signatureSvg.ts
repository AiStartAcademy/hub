const FONT_FAMILY =
  '"Dancing Script", "Snell Roundhand", "Savoye LET", "Brush Script MT", cursive';
const MAX_TYPED_SIGNATURE_NAME_LENGTH = 120;
const SIGNATURE_HEIGHT = 120;
const SIGNATURE_BASE_WIDTH = 320;
const SIGNATURE_HORIZONTAL_PADDING = 64;
const SIGNATURE_CHARACTER_WIDTH = 20;

function escapeXmlText(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

export function renderTypedSignatureSvg(typedName: string): string {
  const normalizedName = typedName.trim();

  if (normalizedName.length === 0) {
    throw new Error("Typed signature name must not be empty");
  }

  if (normalizedName.length > MAX_TYPED_SIGNATURE_NAME_LENGTH) {
    throw new Error(
      `Typed signature name must be ${MAX_TYPED_SIGNATURE_NAME_LENGTH} characters or fewer`,
    );
  }

  // Width grows linearly with the trimmed name length so longer names keep
  // extra horizontal room in the frozen artifact instead of clipping.
  const signatureWidth = Math.max(
    SIGNATURE_BASE_WIDTH,
    normalizedName.length * SIGNATURE_CHARACTER_WIDTH + SIGNATURE_HORIZONTAL_PADDING,
  );
  const escapedFontFamily = escapeXmlText(FONT_FAMILY);
  const escapedName = escapeXmlText(normalizedName);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${signatureWidth}" height="${SIGNATURE_HEIGHT}" viewBox="0 0 ${signatureWidth} ${SIGNATURE_HEIGHT}" role="img" aria-label="Typed signature">`,
    `<text x="24" y="82" fill="#111111" font-family="${escapedFontFamily}" font-size="56" font-weight="600" font-style="italic">${escapedName}</text>`,
    "</svg>",
  ].join("");
}
