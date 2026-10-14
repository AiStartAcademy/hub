import { NextRequest, NextResponse } from "next/server";
import { uploadToGCS, bucket } from "@/lib/gcs";
import { logger } from "@/lib/logger";
import { getSecret } from "@/lib/secrets";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const prompt = body.prompt;
    const image_url = body.image_url;

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    // Resolved through the Integrations store (DB-managed → env fallback), NOT bare
    // process.env — OPENAI_API_KEY is managed at /admin/integrations. Reading env
    // directly made this fail on prod even with the key correctly set there.
    const apiKey = await getSecret("OPENAI_API_KEY");
    if (!apiKey) {
      logger.error("OPENAI_API_KEY not configured (checked Integrations store and env)");
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured — set it at /admin/integrations." },
        { status: 500 }
      );
    }

    logger.info("Generating image for prompt:", prompt);
    let dalleResponse;

    if (image_url) {
      logger.info("Using image-to-image editing API (v1/images/edits)");
      const filename = image_url.startsWith("/api/media/") ? image_url.substring("/api/media/".length) : null;
      let finalBuffer: Buffer | null = null;
      
      if (filename) {
        try {
          const [buffer] = await bucket.file(filename).download();
          finalBuffer = buffer;
        } catch (err) {
          logger.error({ err: err }, "Failed to download reference image from GCS");
        }
      } else {
        try {
          const res = await fetch(image_url);
          finalBuffer = Buffer.from(await res.arrayBuffer());
        } catch(e) {}
      }

      const formData = new FormData();
      formData.append("prompt", prompt);
      formData.append("model", "gpt-image-1.5");
      formData.append("n", "1");
      formData.append("size", "1536x1024");
      
      if (finalBuffer) {
        formData.append("image", new Blob([new Uint8Array(finalBuffer)], { type: "image/png" }), "reference.png");
      }

      dalleResponse = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
        body: formData,
      });
    } else {
      logger.info("Using standard generation API (v1/images/generations)");
      dalleResponse = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-image-1.5",
          prompt: prompt,
          n: 1,
          size: "1536x1024",
        }),
      });
    }

    if (!dalleResponse.ok) {
      const error = await dalleResponse.json();
      logger.error({ err: error }, "OpenAI API error:");
      return NextResponse.json(
        { error: `OpenAI error: ${error.error?.message || "Unknown error"}` },
        { status: dalleResponse.status }
      );
    }

    const data = await dalleResponse.json();
    logger.info({ data: JSON.stringify(data, null, 2)}, "OpenAI Response:");

    // Handle different response structures
    let imageBuffer: Buffer | null = null;

    if (data.data && data.data[0]) {
      const imageData = data.data[0];

      // Handle URL response
      if (imageData.url) {
        logger.info("Downloading image from URL:", imageData.url);
        const imageResponse = await fetch(imageData.url);
        if (!imageResponse.ok) {
          logger.error({ err: imageResponse.statusText}, "Failed to download image:", );
          return NextResponse.json(
            { error: "Failed to download generated image" },
            { status: 500 }
          );
        }
        const arrayBuffer = await imageResponse.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
      }
      // Handle base64 response
      else if (imageData.b64_json) {
        logger.info("Processing base64 image data");
        imageBuffer = Buffer.from(imageData.b64_json, 'base64');
      }
    }

    if (!imageBuffer) {
      logger.error({ err: data }, "Could not find image data in response:");
      return NextResponse.json(
        { error: `Could not find image in response: ${JSON.stringify(data).substring(0, 200)}` },
        { status: 500 }
      );
    }

    logger.info("Image generated successfully");
    logger.info({data: imageBuffer.byteLength }, "Image downloaded, size:");

    // Upload to GCS
    const filename = `course-covers/${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`;
    logger.info( { data : filename }, "Uploading to GCS:" );

    const gcsUrl = await uploadToGCS(
      imageBuffer,
      filename,
      "image/png"
    );

    logger.info({ data : gcsUrl }, "Successfully generated and uploaded image:");
    return NextResponse.json({ url: gcsUrl });
  } catch (error) {
    logger.error({ err: error }, "Image generation error:");
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to generate image: ${errorMessage}` },
      { status: 500 }
    );
  }
}
