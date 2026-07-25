import { NextRequest } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { assertConfig, getEffectiveConfig } from "@/lib/config-provider";
import { runRoleplayTurn } from "@/lib/roleplay/runtime";
import type { RoleplayRequest, RoleplayStreamEvent } from "@/lib/roleplay/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/agent/roleplay — 流式角色对话（NDJSON）。
// 与 /api/agent/chat 同格式：每行一个 JSON 事件，末尾以 {"type":"done"} 收束。
export async function POST(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);

  let body: RoleplayRequest;
  try {
    body = (await req.json()) as RoleplayRequest;
  } catch {
    return jsonError("请求体不是合法 JSON", 400);
  }

  if (!body.projectId || !body.characterId) {
    return jsonError("缺少 projectId 或 characterId", 400);
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
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (ev: RoleplayStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
      };
      try {
        for await (const ev of runRoleplayTurn(request, { ownerId }, req.signal)) {
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
