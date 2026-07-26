import { NextRequest } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { getProject } from "@/lib/storage";
import { syncDocsToTavern } from "@/lib/tavern/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/tavern/sync — 单向把项目的全部 .md 同步进酒馆运行时。
// 前端「.md 同步」按钮调用：body { projectId }。返回 SyncResult。
// 服务端加载 Project（经 lib/storage.getProject），再调 FT-23 的 syncDocsToTavern。
export async function POST(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  let body: { projectId?: string };
  try {
    body = (await req.json()) as { projectId?: string };
  } catch {
    return jsonError("请求体不是合法 JSON", 400);
  }
  const projectId = body.projectId;
  if (!projectId) return jsonError("缺少 projectId", 400);

  const project = await getProject(projectId);
  if (!project) return jsonError("作品不存在", 404);

  const result = await syncDocsToTavern(project, ownerId);
  return json({ ok: true, result });
}

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
