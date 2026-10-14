import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

interface GenerateThumbnailOptions {
  width?: number;
  pageNumber?: number;
}

/**
 * Generate a PNG thumbnail from a PDF page using ghostscript (gs).
 * Requires ghostscript installed in the system (apk add ghostscript on Alpine).
 * Server-side only.
 */
export async function generatePdfThumbnail(
  pdfBuffer: Buffer | ArrayBuffer | Uint8Array,
  options: GenerateThumbnailOptions = {}
): Promise<Buffer> {
  const { width = 400, pageNumber = 1 } = options;

  const buffer =
    pdfBuffer instanceof Buffer ? pdfBuffer : Buffer.from(pdfBuffer as any);

  // Use a temp dir so parallel uploads don't collide
  const tmpDir = await mkdtemp(join(tmpdir(), "pdf-thumb-"));
  const inputPath = join(tmpDir, "input.pdf");
  const outputPath = join(tmpDir, "output.png");

  try {
    await writeFile(inputPath, buffer);

    // -dFirstPage / -dLastPage — render only the requested page
    // -dFIXEDMEDIA -dDEVICEWIDTH — resize to target width
    // -dPDFFitPage — scale page to fit
    await execFileAsync("gs", [
      "-dNOPAUSE",
      "-dBATCH",
      "-dSAFER",
      "-sDEVICE=png16m",
      "-r150",
      `-dFirstPage=${pageNumber}`,
      `-dLastPage=${pageNumber}`,
      `-dDEVICEWIDTHPOINTS=${width}`,
      "-dFIXEDMEDIA",
      "-dPDFFitPage",
      `-sOutputFile=${outputPath}`,
      inputPath,
    ]);

    const imageBuffer = await readFile(outputPath);

    logger.info(
      `[pdf-thumbnail] Generated PNG for page ${pageNumber} via ghostscript` +
        ` (${(imageBuffer.byteLength / 1024).toFixed(1)}KB)`
    );

    return imageBuffer;
  } finally {
    // Always clean up temp files
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}