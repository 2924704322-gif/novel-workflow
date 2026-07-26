import { NextRequest } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { tavernStore } from "@/lib/tavern/store";
import type { Lorebook } from "@/lib/tavern/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/tavern/lorebooks?projectId= — 列出项目级世界书（projectId 可选）。
export async function GET(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  const books = await tavernStore.listLorebooks(ownerId, projectId);
  return json({ lorebooks: books });
}

// POST /api/tavern/lorebooks — 保存世界书（需 id + novelchat.ownerId === ownerId）。
export async function POST(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  let body: Lorebook;
  try {
    body = (await req.json()) as Lorebook;
  } catch {
    return jsonError("请求体不是合法 JSON", 400);
  }
  if (
    !body ||
    typeof body !== "object" ||
    !body.id ||
    body.novelchat?.ownerId !== ownerId
  ) {
    return jsonError("缺少 id 或 novelchat.ownerId 与当前 owner 不一致", 400);
  }
  try {
    await tavernStore.saveLorebook(body);
  } catch (err) {
    return jsonError((err as Error).message || "保存失败", 400);
  }
  return json({ ok: true, id: body.id });
}

// DELETE /api/tavern/lorebooks?id= — 删除世界书（P1-3：先校验归属，防越权删除）。
export async function DELETE(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return jsonError("缺少 id", 400);
  const existing = await tavernStore.readLorebook(id);
  if (existing && existing.novelchat?.ownerId !== ownerId) {
    return jsonError("无权删除该世界书", 403);
  }
  await tavernStore.removeLorebook(id);
  return json({ ok: true });
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
