// 酒馆式角色卡对话 —— 类型定义。
//
// 核心概念：
//   - RoleplayCharacterCard：从 CodexEntry(人物) 派生的角色卡引用
//   - RoleplayMessage：单条对话消息（用户 / 角色 / 系统旁白）
//   - RoleplaySession：一次角色对话会话（持久化为 JSON）
//   - RoleplayRequest / RoleplayStreamEvent：API 请求/响应契约
//
// 数据结构预留多角色扩展：participants 为数组，activeCharacterId 标明当前
// 对话的单一角色（1v1），未来可支持多角色轮转。

import type { ApiConfig, CodexEntry } from "../types";

// ---- 角色卡 ----

/** 从 CodexEntry(人物) 中提取的角色对话所需字段。 */
export interface RoleplayCharacterCard {
  codexId: string;       // 对应 CodexEntry.id
  name: string;          // 角色名（主名称）
  aliases: string[];     // 别名
  summary: string;       // 角色人设概要（来自 CodexEntry.summary）
  status?: string;       // 当前存续状态
  pinned?: boolean;      // 核心角色标记
}

// ---- 消息 ----

export type RoleplayRole = "user" | "character" | "system";

export interface RoleplayMessage {
  id: string;
  role: RoleplayRole;
  characterId?: string;  // role=character 时指明是哪个角色说的（多角色预留）
  content: string;
  createdAt: number;
}

// ---- 会话 ----

export interface RoleplaySession {
  id: string;
  ownerId: string;
  projectId: string;              // 绑定的作品
  participants: RoleplayCharacterCard[];  // 参与角色（1v1 时只有一个，预留多角色）
  activeCharacterId: string;      // 当前 1v1 对话的角色 codexId
  messages: RoleplayMessage[];
  createdAt: number;
  updatedAt: number;
}

// ---- API 契约 ----

export interface RoleplayRequest {
  config: ApiConfig;
  projectId: string;
  characterId: string;           // 对话角色的 codexId
  messages: RoleplayMessage[];   // 多轮历史
  sessionId?: string;            // 续写已有会话（可选）
}

export type RoleplayStreamEvent =
  | { type: "text"; delta: string }         // 角色回复增量
  | { type: "done"; sessionId: string }     // 本轮结束，返回落库的 sessionId
  | { type: "error"; message: string };     // 出错
