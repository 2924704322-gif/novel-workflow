import { NextRequest } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { tavernStore } from "@/lib/tavern/store";
import type { TavernPreset } from "@/lib/tavern/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/tavern/presets?projectId= — 列出当前 owner 的预设（P1-2：接通 tavernStore 落库，
// 替换 FT-22 时的 stub；对齐 SillyTavern 服务端 presets endpoints 的文件落盘范式）。
export async function GET(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  const presets = await tavernStore.listPresets(ownerId, projectId);
  return json({ presets });
}

// POST /api/tavern/presets — 保存预设（注入 ownerId 强制租户隔离，同 characters 路由）。
export async function POST(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  let body: TavernPreset;
  try {
    body = (await req.json()) as TavernPreset;
  } catch {
    return jsonError("请求体不是合法 JSON", 400);
  }
  if (!body || typeof body !== "object" || !body.id || !body.name) {
    return jsonError("缺少 id 或 name", 400);
  }
  body.novelchat = { ...(body.novelchat || {}), ownerId };
  try {
    await tavernStore.savePreset(body);
  } catch (err) {
    return jsonError((err as Error).message || "保存失败", 400);
  }
  return json({ ok: true, id: body.id });
}

// DELETE /api/tavern/presets?id= — 删除预设（先校验归属，防越权删除）。
export async function DELETE(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return jsonError("缺少 id", 400);
  const existing = await tavernStore.readPreset(id);
  if (existing && existing.novelchat?.ownerId !== ownerId) {
    return jsonError("无权删除该预设", 403);
  }
  await tavernStore.removePreset(id);
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
