import { NextRequest } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { applyMdDraftToStorage } from "@/lib/studioActions";
import type { MdDraft } from "@/lib/agent/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/studio/confirm-md — FT-09 确认写入闭环的服务端落点。
//
// P0-1 修复（复审报告 2026-07-26）：applyMdDraftToStorage 依赖 Node fs
// （repository / docsStore / migrate），不可被 "use client" 组件直接 import；
// StudioProvider.confirmMd 改为 POST 本路由，服务端完成落盘后回传定位结果
// （ApplyResult：章节类 volId/chId，设定类 fileName），供 UI 切分段。
export async function POST(req: NextRequest) {
  await resolveAuth(req);
  let body: { projectId?: string; draft?: MdDraft };
  try {
    body = (await req.json()) as { projectId?: string; draft?: MdDraft };
  } catch {
    return jsonError("请求体不是合法 JSON", 400);
  }
  const { projectId, draft } = body;
  if (!projectId || !draft || typeof draft.body !== "string" || !draft.fileName) {
    return jsonError("缺少 projectId 或 draft（需含 fileName/body）", 400);
  }
  if (draft.kind !== "chapter" && draft.kind !== "setting") {
    return jsonError("draft.kind 仅支持 chapter | setting", 400);
  }
  try {
    const result = await applyMdDraftToStorage(projectId, draft);
    return json({ ok: true, result });
  } catch (err) {
    return jsonError((err as Error).message || "落稿失败", 500);
  }
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
