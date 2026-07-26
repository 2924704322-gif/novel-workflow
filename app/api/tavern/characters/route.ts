import { NextRequest } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { tavernStore } from "@/lib/tavern/store";
import type { CharacterCardV2 } from "@/lib/tavern/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/tavern/characters — 列出当前 owner 的角色卡（按 ownerId 隔离）。
export async function GET(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  const cards = await tavernStore.listCharacters(ownerId);
  return json({ cards });
}

// POST /api/tavern/characters — 保存角色卡（需 extensions.novelchat.codexId）。
export async function POST(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  let body: CharacterCardV2;
  try {
    body = (await req.json()) as CharacterCardV2;
  } catch {
    return jsonError("请求体不是合法 JSON", 400);
  }
  if (
    !body ||
    typeof body !== "object" ||
    body.spec !== "chara_card_v2" ||
    !body.extensions?.novelchat?.codexId
  ) {
    return jsonError("缺少 extensions.novelchat.codexId 或非法 CharacterCardV2", 400);
  }
  const codexId = body.extensions.novelchat.codexId; // 已校验存在
  // 注入 ownerId 强制租户隔离：store 读取按 ownerId 过滤，未带 ownerId 的卡不可见。
  body.extensions = {
    ...body.extensions,
    novelchat: { ...body.extensions.novelchat, ownerId },
  };
  try {
    await tavernStore.saveCharacter(body);
  } catch (err) {
    return jsonError((err as Error).message || "保存失败", 400);
  }
  return json({ ok: true, codexId });
}

// DELETE /api/tavern/characters?codexId= — 删除角色卡（P1-3：先校验归属，防越权删除）。
export async function DELETE(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  const codexId = req.nextUrl.searchParams.get("codexId");
  if (!codexId) return jsonError("缺少 codexId", 400);
  const existing = await tavernStore.readCharacter(codexId);
  const cardOwner = existing?.extensions?.novelchat?.ownerId;
  if (existing && cardOwner && cardOwner !== ownerId) {
    return jsonError("无权删除该角色卡", 403);
  }
  await tavernStore.removeCharacter(codexId);
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
