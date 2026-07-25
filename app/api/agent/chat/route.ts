import { NextRequest } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { assertConfig, getEffectiveConfig } from "@/lib/config-provider";
import { runAgentTurn } from "@/lib/agent/runtime";
import { sessionRepository } from "@/lib/agent/session-store";
import type {
  AgentChatRequest,
  AgentStreamEvent,
  ChatMessage,
  ChatSession,
  ChatToolCall,
} from "@/lib/agent/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/agent/chat — 流式回传 AgentStreamEvent（NDJSON：逐行一个 JSON 事件）。
// 序列化格式（供 Sub B 对齐）：Content-Type=application/x-ndjson，
// 每行是一个 AgentStreamEvent 的 JSON.stringify，以 \n 分隔；末尾必有 {"type":"done"}。
export async function POST(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);

  let body: AgentChatRequest;
  try {
    body = (await req.json()) as AgentChatRequest;
  } catch {
    return jsonError("请求体不是合法 JSON", 400);
  }

  // 接缝④：集中取生效配置并校验。
  let config;
  try {
    config = assertConfig(getEffectiveConfig(body.config, ownerId));
  } catch (err) {
    return jsonError((err as Error).message, 400);
  }

  const request: AgentChatRequest = {
    config,
    messages: Array.isArray(body.messages) ? body.messages : [],
    projectId: body.projectId,
    confirmations: body.confirmations,
    skillId: body.skillId,
    skillParams: body.skillParams,
  };

  const encoder = new TextEncoder();

  // 累积本轮助手消息，供落库（§3.6）。
  let assistantText = "";
  const toolCalls: ChatToolCall[] = [];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (ev: AgentStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
      };
      try {
        for await (const ev of runAgentTurn(request, { ownerId }, req.signal)) {
          // 累积可落库的内容。
          if (ev.type === "text") assistantText += ev.delta;
          else if (ev.type === "tool_call") toolCalls.push({ name: ev.name, args: ev.args });
          else if (ev.type === "tool_result") {
            const last = toolCalls[toolCalls.length - 1];
            if (last && last.name === ev.name && last.result === undefined) last.result = ev.result;
            else toolCalls.push({ name: ev.name, args: null, result: ev.result });
          }
          emit(ev);
        }
      } catch (err) {
        emit({ type: "error", message: (err as Error).message });
        emit({ type: "done" });
      } finally {
        controller.close();
      }

      // 落库：一本作品对应一段可续写的对话（契约请求未带 sessionId，故按作品收敛）。
      try {
        await persistSession(ownerId, request, assistantText, toolCalls);
      } catch {
        // 落库失败不影响本轮已回传的结果。
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

async function persistSession(
  ownerId: string,
  request: AgentChatRequest,
  assistantText: string,
  toolCalls: ChatToolCall[]
): Promise<void> {
  const sessionId = `chat-${request.projectId || "global"}`;
  const existing = await sessionRepository.get(ownerId, sessionId);
  const now = Date.now();

  const assistantMsg: ChatMessage = {
    role: "assistant",
    content: assistantText,
    toolCalls: toolCalls.length ? toolCalls : undefined,
  };
  const messages: ChatMessage[] = [...request.messages, assistantMsg];

  const firstUser = request.messages.find((m) => m.role === "user");
  const title =
    existing?.title ||
    (firstUser?.content ? firstUser.content.slice(0, 24) : "未命名对话");

  const session: ChatSession = {
    id: sessionId,
    ownerId,
    projectId: request.projectId,
    title,
    messages,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await sessionRepository.save(ownerId, session);
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
