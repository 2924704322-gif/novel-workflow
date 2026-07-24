// Agent 对话运行时的共享契约（系统规范 §3.2 / §3.5 / §3.6）。
//
// 契约冻结（阶段 0）——这是 Sub A（后端 /api/agent/chat + runtime）与
// Sub B（客户端 AgentChat 面板）之间的唯一接口约定，双方都 import 本文件，勿擅改。
// 需要调整时先在主会话更新本文件与 TASKBOARD.md，再同步两个子分支。

import type { ApiConfig } from "../types";

// ---- 会话数据模型（§3.6，经 Repository 落存储：本地 JSON / 未来 DB） ----

export type ChatRole = "user" | "assistant" | "tool";

export interface ChatToolCall {
  name: string; // 工具名（见系统规范 §3.4 工具清单）
  args: unknown; // 入参
  result?: unknown; // 执行结果（只读/生成类工具直接带回）
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: ChatToolCall[];
}

export interface ChatSession {
  id: string;
  ownerId: string; // 接缝③，本地固定 "local"
  projectId?: string; // 绑定的作品（可空 = 尚未选书）
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// ---- Human-in-the-loop 写操作确认流（§3.5） ----

// 一份待人工确认的写操作提案：Agent 产出提案而非静默落库，
// UI 展示 changeSummary + diff，用户确认后回传 ConfirmToken 才真正执行。
export interface ChangeProposal {
  id: string; // 提案 id，确认时按此回传
  tool: string; // 触发的写工具名（如 save_project / apply_reconcile）
  args: unknown; // 待执行入参
  changeSummary: string; // 人类可读的变更摘要
  diff?: unknown; // 目标 diff（结构由具体工具定义）
}

export interface ConfirmToken {
  proposalId: string; // 对应 ChangeProposal.id
  approved: boolean; // true=执行，false=丢弃
}

// ---- 请求体：客户端 → /api/agent/chat（§3.2） ----

export interface AgentChatRequest {
  config: ApiConfig; // 模型与密钥（接缝④，仍由客户端携带）
  messages: ChatMessage[]; // 多轮对话历史
  projectId?: string; // 当前作品上下文（可空）
  confirmations?: ConfirmToken[]; // 上一轮提案的确认结果
}

// ---- 流式事件：/api/agent/chat 逐块回传（§3.2 响应） ----
// 服务端以分块流回传下列事件之一（序列化格式由 runtime 决定，
// 客户端按 type 分发渲染）。

export type AgentStreamEvent =
  | { type: "text"; delta: string } // 助手文本增量
  | { type: "tool_call"; name: string; args: unknown } // 工具开始调用
  | { type: "tool_result"; name: string; result: unknown } // 工具返回
  | { type: "proposal"; proposal: ChangeProposal } // 待确认写操作提案
  | { type: "done" } // 本轮结束
  | { type: "error"; message: string }; // 出错
