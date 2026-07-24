// Agent 运行时：工具循环 + 写操作确认流编排（系统规范 §3.2 / §3.4 / §3.5）。
//
// 因项目未安装 Vercel AI SDK，这里自实现一个 OpenAI 兼容的 function-calling
// 循环（llm.ts 的 streamChat 不支持 tool_calls，故本文件另发请求）。工具的
// 领域实现全在 lib/agent/tools.ts，本文件只负责：
//   1) 与模型往返，解析 tool_calls；
//   2) 只读/生成类工具立即 run() 并把结果回喂模型；
//   3) 写操作类工具 propose() 产出 ChangeProposal、持久化后 emit，停在本轮等确认；
//   4) 下一轮凭 confirmations 取回提案，approved 则 apply() 落库。
// 逐个产出 AgentStreamEvent（冻结契约），由 route 序列化为 NDJSON。
//
// 归属：Sub A（后端）。

import type { ApiConfig } from "../types";
import type {
  AgentChatRequest,
  AgentStreamEvent,
  ChangeProposal,
  ChatMessage,
} from "./types";
import { TOOLS_BY_NAME, toolSchemas, type ToolContext } from "./tools";
import {
  deletePendingProposal,
  getPendingProposal,
  savePendingProposal,
} from "./session-store";

// ---- OpenAI 兼容请求（自带，因需 tools/tool_calls 支持） ---------------------

// 与 llm.ts 的 normalizeBaseUrl 保持一致：允许粘贴裸主机或 .../v1。
function normalizeBaseUrl(baseUrl: string): string {
  let b = (baseUrl || "").trim().replace(/\/+$/, "");
  if (!/\/v\d+$/.test(b) && !b.endsWith("/chat/completions")) {
    b = `${b}/v1`;
  }
  return b;
}

function completionsUrl(cfg: ApiConfig): string {
  const base = normalizeBaseUrl(cfg.baseUrl);
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

interface OAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

// 非流式取整条助手消息（含可能的 tool_calls）。工具循环用非流式更稳。
async function chatCompletion(
  cfg: ApiConfig,
  messages: OAIMessage[],
  signal?: AbortSignal
): Promise<OAIMessage> {
  const res = await fetch(completionsUrl(cfg), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      tools: toolSchemas(),
      tool_choice: "auto",
      temperature: cfg.temperature ?? 0.7,
      stream: false,
    }),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`模型接口返回错误 ${res.status}. ${detail.slice(0, 500)}`);
  }
  const json = await res.json();
  const msg = json?.choices?.[0]?.message;
  if (!msg) throw new Error("模型未返回有效消息。");
  return msg as OAIMessage;
}

// ---- 系统提示 -------------------------------------------------------------

function systemPrompt(projectId?: string): string {
  const lines = [
    "你是「墨章」写作工作台的对话助手，帮助作者规划、生成与维护长篇小说。",
    "你可以调用平台提供的工具来读取/生成/写入作品数据：",
    "- A 组（数据）：列出/读取/新建/保存/删除作品；",
    "- B 组（生成）：设定集、分卷、单卷章纲、单章脉络、正文、归档摘要、滚动前情、一致性校正；",
    "- C 组（记忆）：组装章节上下文、检索世界档案、折回归档/校正。",
    "生成类工具只产出候选，不落库；要持久化必须再调用写工具（如 save_project）。",
    "所有写操作（write）都会先生成变更提案交用户确认，你只管按需调用工具即可，平台会处理确认流程；不要假装已经保存成功。",
    "调用工具时优先使用已绑定的作品，无需反复询问 projectId。用中文与用户交流，回答简洁。",
  ];
  if (projectId) lines.push(`当前会话已绑定作品 id：${projectId}。`);
  else lines.push("当前会话尚未绑定作品；涉及具体作品时先 list_projects 或让用户选书。");
  return lines.join("\n");
}

// 把契约里的 ChatMessage 历史转成 OpenAI 消息序列。
function toOAIMessages(history: ChatMessage[], projectId?: string): OAIMessage[] {
  const out: OAIMessage[] = [{ role: "system", content: systemPrompt(projectId) }];
  for (const m of history) {
    if (m.role === "tool") {
      // 历史里的工具消息以可读文本回喂（无需还原 tool_call_id）。
      out.push({ role: "user", content: `（工具结果）${m.content}` });
      continue;
    }
    out.push({ role: m.role, content: m.content || "" });
  }
  return out;
}

// ---- 工具循环 --------------------------------------------------------------

function rid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const MAX_STEPS = 8;

export interface RuntimeContext {
  ownerId: string;
}

/**
 * 运行一轮对话，逐个产出 AgentStreamEvent。
 * 若模型触发写操作，则产出 proposal 事件后结束本轮，等待下一轮 confirmations。
 */
export async function* runAgentTurn(
  req: AgentChatRequest,
  rt: RuntimeContext,
  signal?: AbortSignal
): AsyncGenerator<AgentStreamEvent> {
  const toolCtx: ToolContext = {
    ownerId: rt.ownerId,
    config: req.config,
    projectId: req.projectId,
  };

  const oai = toOAIMessages(req.messages, req.projectId);

  // 1) 先处理上一轮提案的确认结果（§3.5 跨轮桥接）。
  const confirmations = req.confirmations || [];
  for (const c of confirmations) {
    const stored = await getPendingProposal(c.proposalId);
    if (!stored) {
      yield { type: "error", message: `提案已失效或不存在：${c.proposalId}` };
      continue;
    }
    const tool = TOOLS_BY_NAME[stored.proposal.tool];
    if (!c.approved) {
      await deletePendingProposal(c.proposalId);
      yield {
        type: "tool_result",
        name: stored.proposal.tool,
        result: { discarded: true, reason: "用户已取消该写操作" },
      };
      oai.push({
        role: "system",
        content: `用户取消了写操作「${stored.proposal.tool}」：${stored.proposal.changeSummary}。`,
      });
      continue;
    }
    try {
      if (!tool?.apply) throw new Error(`写工具不可执行：${stored.proposal.tool}`);
      const applyCtx: ToolContext = {
        ownerId: stored.ownerId || rt.ownerId,
        config: req.config,
        projectId: stored.projectId ?? req.projectId,
      };
      const result = await tool.apply(stored.proposal.args as Record<string, any>, applyCtx);
      yield { type: "tool_result", name: stored.proposal.tool, result };
      oai.push({
        role: "system",
        content: `写操作「${stored.proposal.tool}」已确认并执行完毕：${stored.proposal.changeSummary}。`,
      });
    } catch (err) {
      yield {
        type: "error",
        message: `执行写操作失败（${stored.proposal.tool}）：${(err as Error).message}`,
      };
    } finally {
      await deletePendingProposal(c.proposalId);
    }
  }

  // 2) 模型工具循环。
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal?.aborted) return;
      const msg = await chatCompletion(req.config, oai, signal);
      const calls = msg.tool_calls || [];

      // 模型可能同时带文本与工具调用。
      if (msg.content) yield { type: "text", delta: msg.content };

      if (calls.length === 0) {
        yield { type: "done" };
        return;
      }

      // 记录本轮助手消息（含 tool_calls），以便回喂只读工具结果。
      oai.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: calls,
      });

      let emittedProposal = false;

      for (const call of calls) {
        const name = call.function?.name || "";
        let args: Record<string, any> = {};
        try {
          args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = {};
        }
        yield { type: "tool_call", name, args };

        const tool = TOOLS_BY_NAME[name];
        if (!tool) {
          const result = { error: `未知工具：${name}` };
          yield { type: "tool_result", name, result };
          oai.push({
            role: "tool",
            tool_call_id: call.id,
            name,
            content: JSON.stringify(result),
          });
          continue;
        }

        if (tool.write) {
          // 写操作：产出提案、持久化、emit，稍后停在本轮。
          try {
            const built = tool.propose
              ? await tool.propose(args, toolCtx)
              : { changeSummary: `执行写操作 ${name}` };
            // propose 可通过 argsPatch 回填确认落库所需的确定性字段（如预分配 id），
            // 并入 proposal.args 后 apply 即幂等：重复确认只覆盖同一目标而非新建。
            const patch = (built as { argsPatch?: Record<string, unknown> }).argsPatch;
            const finalArgs = patch ? { ...args, ...patch } : args;
            const proposal: ChangeProposal = {
              id: rid(),
              tool: name,
              args: finalArgs,
              changeSummary: built.changeSummary,
              diff: built.diff,
            };
            await savePendingProposal({
              proposal,
              ownerId: rt.ownerId,
              projectId: req.projectId,
              createdAt: Date.now(),
            });
            yield { type: "proposal", proposal };
            emittedProposal = true;
          } catch (err) {
            yield {
              type: "error",
              message: `准备写操作失败（${name}）：${(err as Error).message}`,
            };
          }
          continue;
        }

        // 只读 / 生成类：立即执行并把结果回喂模型。
        try {
          const result = tool.run ? await tool.run(args, toolCtx) : null;
          yield { type: "tool_result", name, result };
          oai.push({
            role: "tool",
            tool_call_id: call.id,
            name,
            content: JSON.stringify(result ?? null),
          });
        } catch (err) {
          const result = { error: (err as Error).message };
          yield { type: "tool_result", name, result };
          oai.push({
            role: "tool",
            tool_call_id: call.id,
            name,
            content: JSON.stringify(result),
          });
        }
      }

      // 有写操作待确认：结束本轮，等待用户回传 confirmations。
      if (emittedProposal) {
        yield { type: "done" };
        return;
      }
      // 否则带着工具结果继续下一轮。
    }

    // 超出步数上限。
    yield {
      type: "error",
      message: `工具调用步数超过上限（${MAX_STEPS}），已停止本轮。`,
    };
    yield { type: "done" };
  } catch (err) {
    yield { type: "error", message: (err as Error).message };
    yield { type: "done" };
  }
}
