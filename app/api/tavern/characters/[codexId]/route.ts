import { NextRequest } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { tavernStore } from "@/lib/tavern/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/tavern/characters/:codexId — 读取单张角色卡全文（供编辑 / 导出）。
// P1-3 修复：补 resolveAuth + ownerId 归属校验（未带 ownerId 的旧卡放行，
// 与列表接口的过滤语义一致；带了但不匹配则 403）。
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ codexId: string }> }
) {
  const { ownerId } = await resolveAuth(req);
  const { codexId } = await params;
  const card = await tavernStore.readCharacter(codexId);
  if (!card) return jsonError("角色卡不存在", 404);
  const cardOwner = card.extensions?.novelchat?.ownerId;
  if (cardOwner && cardOwner !== ownerId) {
    return jsonError("无权访问该角色卡", 403);
  }
  return json({ card });
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
