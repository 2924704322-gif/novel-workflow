import { NextResponse } from "next/server";
import { listStyleCards } from "@/lib/storage";

export const dynamic = "force-dynamic";

// GET /api/styles -> all saved style cards (拆书学文风卡库), newest first.
export async function GET() {
  const cards = await listStyleCards();
  return NextResponse.json(cards);
}
