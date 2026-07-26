import { NextRequest } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { projectRepository } from "@/lib/repository";
import { docsStore } from "@/lib/docsStore";
import { migrateBibleToDocs } from "@/lib/migrate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/projects/:id/docs           — 列出该书全部 .md 文档（DocMeta[]）。
// GET /api/projects/:id/docs?name=x.md — 读取单篇文档全文（DocRecord）。
//
// P0-1 修复（复审报告 2026-07-26）：client 组件不得直连基于 Node fs 的
// docsStore / migrate，统一改走本路由（对齐 GitHub 社区 Next.js App Router 实践）。
// FT-10 首开旧书迁移下沉到服务端：list 为空且有 bible 时一次性拆出 .md（幂等）。
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ownerId } = await resolveAuth(req);
  const { id } = await params;
  const name = req.nextUrl.searchParams.get("name");

  if (name) {
    const record = await docsStore.read(id, name);
    if (!record) return jsonError("文档不存在", 404);
    return json({ doc: record });
  }

  let list = await docsStore.list(id);
  if (list.length === 0) {
    // FT-10：首开旧书迁移（bible → docs，幂等；无 bible / 无项目则跳过）
    const project = await projectRepository.get(ownerId, id);
    if (project?.bible) {
      await migrateBibleToDocs(project);
      list = await docsStore.list(id);
    }
  }
  return json({ docs: list });
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
