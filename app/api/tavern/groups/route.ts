import { NextRequest } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { tavernStore } from "@/lib/tavern/store";
import type { RoleplayGroup } from "@/lib/tavern/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/tavern/groups?projectId= — 列出项目群组（projectId 必填）。
export async function GET(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return jsonError("缺少 projectId", 400);
  const groups = await tavernStore.listGroups(ownerId, projectId);
  return json({ groups });
}

// POST /api/tavern/groups — 保存群组（需 id + novelchat.ownerId/projectId）。
export async function POST(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  let body: RoleplayGroup;
  try {
    body = (await req.json()) as RoleplayGroup;
  } catch {
    return jsonError("请求体不是合法 JSON", 400);
  }
  if (
    !body ||
    typeof body !== "object" ||
    !body.id ||
    body.novelchat?.ownerId !== ownerId ||
    !body.novelchat?.projectId
  ) {
    return jsonError("缺少 id 或 novelchat.ownerId/projectId 不合法", 400);
  }
  try {
    await tavernStore.saveGroup(body);
  } catch (err) {
    return jsonError((err as Error).message || "保存失败", 400);
  }
  return json({ ok: true, id: body.id });
}

// DELETE /api/tavern/groups?id= — 删除群组（P1-3：先校验归属，防越权删除）。
export async function DELETE(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return jsonError("缺少 id", 400);
  const existing = await tavernStore.readGroup(id);
  if (existing && existing.novelchat?.ownerId !== ownerId) {
    return jsonError("无权删除该群组", 403);
  }
  await tavernStore.removeGroup(id);
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
