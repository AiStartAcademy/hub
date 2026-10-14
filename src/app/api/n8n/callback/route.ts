import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

interface N8nCallbackBody {
  programId: string;
  courseFolderLink: string;
  moduleFolderLink: string | null;
}

export async function POST(req: NextRequest) {
  // Auth via secret token
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");
  const callbackSecret = process.env.N8N_CALLBACK_SECRET;

  if (!callbackSecret?.trim()) {
    return NextResponse.json(
      { error: "n8n callback not configured" },
      { status: 503 }
    );
  }

  if (token !== callbackSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: N8nCallbackBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { programId, courseFolderLink, moduleFolderLink } = body;

  if (!programId || !courseFolderLink) {
    return NextResponse.json(
      { error: "programId and courseFolderLink are required" },
      { status: 422 }
    );
  }

  // have to use actions.ts/updateProgram ??????????????????
  const program = await prisma.program.update({
    where: { id: programId },
    data: {} //{ courseFolderLink, moduleFolderLink: moduleFolderLink ?? null },
  });

  revalidatePath(`/courses/${programId}`);
  revalidatePath("/courses");

  return NextResponse.json({ success: true, programId: program.id });
}
