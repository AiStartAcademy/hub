// src/lib/pdfGenerator.ts
import puppeteer from "puppeteer"; // Full puppeteer, not puppeteer-core
import { logger } from "./logger";

/**
 * Renders an HTML string to PDF and PNG buffers
 */
export async function renderCertificateFromHtml(htmlString: string): Promise<{ pdfBuffer: Buffer; pngBuffer: Buffer }> {
  let browser = null;
  try {
    // Chrome is installed in the Docker image ('npx puppeteer browsers install chrome'),
    // so a plain launch() finds the binary.
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
      ],
      defaultViewport: { 
        width: 1200, 
        height: 1553, 
        deviceScaleFactor: 2 
      },
      headless: true,
    });

    const page = await browser.newPage();
    
    // Force the viewport size for this tab
    await page.setViewport({ 
      width: 1200, 
      height: 1553, 
      deviceScaleFactor: 2 
    });
    
    await page.setContent(htmlString, { waitUntil: "load" });

    logger.info(`[Puppeteer] Page loaded. Rendering PDF and PNG...`);
    
    // Long enough for Google Fonts to load
    await page.evaluateHandle('document.fonts.ready');

    const pdfBytes = await page.pdf({
      printBackground: true,
      width: "12.5in",     // Exactly 1200px
      height: "16.177in",  // Exactly 1553px
      pageRanges: "1",
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    // Instead of fullPage: true (which sometimes misjudges the body bounds),
    // clip exactly from 0,0 to 1200x1553
    const pngBytes = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: 1200, height: 1553 }
    });

    return {
      pdfBuffer: Buffer.from(pdfBytes),
      pngBuffer: Buffer.from(pngBytes),
    };
  } catch (error) {
    logger.error({ err: error }, "[Puppeteer] Failed to render PDF/PNG:");
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}