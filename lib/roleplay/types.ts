// 酒馆式角色卡对话 —— 类型定义。
//
// 核心概念：
//   - RoleplayCharacterCard：从 CodexEntry(人物) 派生的角色卡引用
//   - RoleplayMessage：单条对话消息（用户 / 角色 / 系统旁白）
//   - RoleplaySession：一次角色对话会话（持久化为 JSON）
//   - RoleplayRequest / RoleplayStreamEvent：API 请求/响应契约
//
// 数据结构支持多角色轮转：participants 为数组，turnMode 控制轮转策略，
// activeCharacterId 标明当前回合的发言角色。

import type { ApiConfig, CodexEntry } from "../types";
import type { RoleplayGroup } from "../tavern/types";

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
  characterId?: string;  // role=character 时指明是哪个角色说的（多角色区分）
  content: string;
  createdAt: number;
}

// ---- 轮转策略 ----

/** 多角色对话的轮转模式。 */
export type TurnMode = "manual" | "round-robin" | "narrator-driven";

// ---- 会话 ----

export interface RoleplaySession {
  id: string;
  ownerId: string;
  projectId: string;              // 绑定的作品
  participants: RoleplayCharacterCard[];  // 参与角色（1个=1v1，多个=群聊）
  activeCharacterId: string;      // 当前回合的发言角色 codexId
  turnMode: TurnMode;             // 轮转策略
  turnOrder: string[];            // codexId 数组，round-robin 的轮转顺序
  nextSpeakerIndex: number;       // round-robin 时的当前指针
  messages: RoleplayMessage[];
  createdAt: number;
  updatedAt: number;
}

// ---- API 契约 ----

export interface RoleplayRequest {
  config: ApiConfig;
  projectId: string;
  characterId: string;           // 1v1 时的对话角色 codexId
  messages: RoleplayMessage[];   // 多轮历史
  sessionId?: string;            // 续写已有会话（可选）
  // 多角色扩展
  participants?: RoleplayCharacterCard[];  // 多角色参与者列表
  turnMode?: TurnMode;                    // 轮转策略
  targetCharacterId?: string;             // manual 模式下指定下一位发言者
  // —— 酒馆AI 群组 / lorebook 扩展（FT-18/FT-19/FT-20，向后兼容，全可选）——
  groupId?: string;                       // 走群组范式（RoleplayGroup.id）
  lorebookIds?: string[];                 // 显式指定额外 lorebook
  scanDepth?: number;                     // lorebook 扫描深度（覆盖默认 20）
  tokenBudget?: number;                   // lorebook token 预算（覆盖默认 1024）
  activationStrategy?: RoleplayGroup["activationStrategy"]; // manual 时前端指定
  generationMode?: RoleplayGroup["generationMode"];        // swap | append
  scenarioOverride?: string;              // 群组/请求级 scenario 覆盖
}

export type RoleplayStreamEvent =
  | { type: "text"; delta: string }         // 角色回复增量
  | { type: "done"; sessionId: string; nextSpeaker?: string }  // 本轮结束
  | { type: "error"; message: string };     // 出错
