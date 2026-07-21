import { NextRequest, NextResponse } from "next/server";
import { listProjects, saveProject } from "@/lib/storage";
import { emptyProject, toSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/projects -> list of lightweight project summaries
export async function GET() {
  const projects = await listProjects();
  return NextResponse.json(projects.map(toSummary));
}

// POST /api/projects -> create a new empty project
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const title = (body.title as string)?.trim() || "未命名作品";
  const id = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const project = emptyProject(id, title);
  await saveProject(project);
  return NextResponse.json(project, { status: 201 });
}
