import { NextRequest, NextResponse } from "next/server";
import { deleteProject, getProject, saveProject } from "@/lib/storage";
import type { Project } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/projects/:id -> full project
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  }
  return NextResponse.json(project);
}

// PUT /api/projects/:id -> replace the whole project document
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await getProject(id);
  if (!existing) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  }
  const body = (await req.json()) as Project;
  // keep the id/createdAt stable regardless of client payload
  const merged: Project = {
    ...body,
    id: existing.id,
    createdAt: existing.createdAt,
  };
  const saved = await saveProject(merged);
  return NextResponse.json(saved);
}

// DELETE /api/projects/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await deleteProject(id);
  return NextResponse.json({ ok: true });
}
