import { NextRequest, NextResponse } from "next/server";
import { getStyleCard, saveStyleCard, deleteStyleCard } from "@/lib/storage";
import type { StyleCard } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/styles/:hash -> cached style card for a source file, or 404.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;
  const card = await getStyleCard(hash);
  if (!card) {
    return NextResponse.json({ error: "无缓存" }, { status: 404 });
  }
  return NextResponse.json(card);
}

// PUT /api/styles/:hash -> persist a freshly analyzed style card.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;
  const body = (await req.json()) as StyleCard;
  const saved = await saveStyleCard({ ...body, sourceFileHash: hash });
  return NextResponse.json(saved);
}

// DELETE /api/styles/:hash -> remove a saved style card from the library.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;
  await deleteStyleCard(hash);
  return NextResponse.json({ ok: true });
}
