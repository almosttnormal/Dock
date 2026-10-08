import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { processDriveChanges } from "@/lib/drive/changes";
import { logger } from "@/lib/log";

export async function GET(req: Request) {
  return handlePoll(req);
}

export async function POST(req: Request) {
  return handlePoll(req);
}

async function handlePoll(req: Request) {
  const env = getEnv();

  // Strictly require Bearer CRON_SECRET
  const authHeader = req.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const result = await processDriveChanges();
    return NextResponse.json({
      success: true,
      result,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("Manual poll failed", { error: err });
    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
      },
      { status: 500 }
    );
  }
}
