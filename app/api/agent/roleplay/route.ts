import { NextRequest } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { assertConfig, getEffectiveConfig } from "@/lib/config-provider";
import { runRoleplayTurn, runMultiRoleplayTurn, runGroupTurn } from "@/lib/roleplay/runtime";
import type { RoleplayRequest, RoleplayStreamEvent } from "@/lib/roleplay/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/agent/roleplay — 流式角色对话（NDJSON）。
// 与 /api/agent/chat 同格式：每行一个 JSON 事件，末尾以 {"type":"done"} 收束。
//
// 路径选择（向后兼容 + 酒馆AI 群组扩展，FT-18/19/20）：
//   - groupId 存在            → runGroupTurn（加载群组 → 选角 → 加载成员卡 → 扫描
//                                lorebook → assembleRoleContext → 流式生成）。
//   - 无 groupId 且多角色      → runMultiRoleplayTurn（原 round-robin / manual）。
//   - 无 groupId 且单角色      → runRoleplayTurn（原 1v1）。
//
// 新增请求字段（全可选，向后兼容现有调用）：groupId / lorebookIds / scanDepth /
// tokenBudget / activationStrategy / generationMode / scenarioOverride。
export async function POST(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);

  let body: Partial<RoleplayRequest>;
  try {
    body = (await req.json()) as Partial<RoleplayRequest>;
  } catch {
    return jsonError("请求体不是合法 JSON", 400);
  }

  if (!body.projectId || !body.characterId) {
    return jsonError("缺少 projectId 或 characterId", 400);
  }

  // 群组范式校验：activationStrategy 仅群组有意义，缺 groupId 时给出清晰错误事件对齐 FT-18。
  if (body.activationStrategy && !body.groupId) {
    return jsonError("activationStrategy 仅群组模式可用，缺少 groupId", 400);
  }

  let config;
  try {
    config = assertConfig(getEffectiveConfig(body.config, ownerId));
  } catch (err) {
    return jsonError((err as Error).message, 400);
  }

  const request: RoleplayRequest = {
    config,
    projectId: body.projectId,
    characterId: body.characterId,
    messages: Array.isArray(body.messages) ? body.messages : [],
    sessionId: body.sessionId,
    // 多角色（1v1 / 多角色，向后兼容）
    participants: body.participants,
    turnMode: body.turnMode,
    targetCharacterId: body.targetCharacterId,
    // —— 酒馆AI 群组 / lorebook 扩展（FT-18/19/20，向后兼容，全可选）——
    groupId: body.groupId,
    lorebookIds: body.lorebookIds,
    scanDepth: body.scanDepth,
    tokenBudget: body.tokenBudget,
    activationStrategy: body.activationStrategy,
    generationMode: body.generationMode,
    scenarioOverride: body.scenarioOverride,
  };

  // 路径选择
  const isMulti = request.participants && request.participants.length > 1;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (ev: RoleplayStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
      };
      try {
        const gen = request.groupId
          ? runGroupTurn(request, { ownerId }, req.signal)
          : isMulti
          ? runMultiRoleplayTurn(request, { ownerId }, req.signal)
          : runRoleplayTurn(request, { ownerId }, req.signal);
        for await (const ev of gen) {
          emit(ev);
        }
      } catch (err) {
        emit({ type: "error", message: (err as Error).message });
        emit({ type: "done", sessionId: "" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
