import { NextRequest, NextResponse } from "next/server";
import { getArchive, saveArchive, deleteArchive } from "@/lib/storage";
import type { StoryArchive } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/archives/:hash -> cached story archive for a source file, or 404.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;
  const archive = await getArchive(hash);
  if (!archive) {
    return NextResponse.json({ error: "无缓存" }, { status: 404 });
  }
  return NextResponse.json(archive);
}

// PUT /api/archives/:hash -> persist a freshly analyzed story archive.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;
  const body = (await req.json()) as StoryArchive;
  const saved = await saveArchive({ ...body, sourceFileHash: hash });
  return NextResponse.json(saved);
}

// DELETE /api/archives/:hash -> remove a saved story archive from the library.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;
  await deleteArchive(hash);
  return NextResponse.json({ ok: true });
}
