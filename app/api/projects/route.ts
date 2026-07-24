import { NextRequest, NextResponse } from "next/server";
import { projectRepository } from "@/lib/repository";
import { resolveAuth } from "@/lib/auth";
import { emptyProject, toSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

// 接缝②③（系统规范 §2）：数据访问统一经 projectRepository，并带上鉴权注入的 ownerId。
// ownerId="local" 时落盘路径与改造前完全一致（旧作品零迁移）。

// GET /api/projects -> list of lightweight project summaries
export async function GET(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  const projects = await projectRepository.list(ownerId);
  return NextResponse.json(projects.map(toSummary));
}

// POST /api/projects -> create a new empty project
export async function POST(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  const body = await req.json().catch(() => ({}));
  const title = (body.title as string)?.trim() || "未命名作品";
  const id = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const project = emptyProject(id, title);
  await projectRepository.save(ownerId, project);
  return NextResponse.json(project, { status: 201 });
}
