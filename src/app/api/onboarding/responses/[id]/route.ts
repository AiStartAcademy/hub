// src/app/api/onboarding/responses/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9_-]{10,40}$/i.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  
  const response = await prisma.onboardingResponse.findUnique({
    where: { id },
    select: { status: true, aiResult: true }
  });

  if (!response) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let parsedAiResult = null;
  if (response.aiResult) {
    try {
      parsedAiResult = JSON.parse(response.aiResult);
    } catch {
      // The AI returned invalid JSON
      parsedAiResult = { reasoning: response.aiResult }; 
    }
  }

  return NextResponse.json(
    {
      status: response.status,
      aiResult: parsedAiResult,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
