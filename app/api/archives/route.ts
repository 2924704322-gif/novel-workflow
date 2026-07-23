import { NextResponse } from "next/server";
import { listArchives } from "@/lib/storage";

export const dynamic = "force-dynamic";

// GET /api/archives -> all saved story archives (拆书学设定卡库), newest first.
export async function GET() {
  const archives = await listArchives();
  return NextResponse.json(archives);
}
