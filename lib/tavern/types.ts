// 酒馆AI 数据模型 —— 对齐 SillyTavern Character Card V2 规范（FT-15 / FT-16 基础）
//
// 权威来源：github.com/malfoyslastname/character-card-spec-v2（2023-05 批准）。
// GitHub 取经结论（关键规范约束）：
//   - spec / spec_version 为固定标识，禁止进入 prompt 工程。
//   - extensions 为“必须存在、默认 {}”的扩展槽；前端/编辑器不得破坏未知键；
//     自定义键必须命名空间化以避免冲突 → 本实现统一使用 extensions.novelchat。
//   - character_book（角色私有 Lorebook）位于 data 内，可选；与“世界书”叠加使用。
//
// 扩展说明：本实现的 novelchat 命名空间在 V2 之上增加 ownerId，用于 tavernStore
// 的租户隔离（ownerId 过滤防越权，对齐 lib/storage.ts 的 safeId/ownerId 模式）。
// 该字段为可选，缺失时不影响 V2 兼容性（Q4 三方共存、不回写 codex）。

export interface CharacterCardV2 {
  spec: "chara_card_v2";
  spec_version: "2.0";
  data: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    system_prompt: string;
    alternate_greetings: string[];
    character_book?: Lorebook;
    tags: string[];
    creator: string;
    character_version?: string;
    // V2 还允许 creator_notes / post_history_instructions 等字段，按需扩展；
    // 此处仅列落地所需字段，其余未知键经 extensions 保留。
  };
  extensions?: {
    novelchat?: {
      /** 主键：关联 CodexEntry.id（三方共存，不回写 codex，Q4） */
      codexId: string;
      pinned?: boolean;
      status?: string;
      projectId?: string;
      category?: string;
      /** 扩展：tavernStore 租户隔离用（V2 规范兼容，可选） */
      ownerId?: string;
    };
    // 预留其它命名空间，保留未知键
    [key: string]: unknown;
  };
}

export interface LorebookEntry {
  id: string;
  keys: string[];
  content: string;
  enabled: boolean;
  insertion_order: number;
  case_sensitive?: boolean;
  name?: string;
  priority?: number;
  comment?: string;
  selective?: boolean;
  secondary_keys?: string[];
  constant?: boolean;
  position?: "before_char" | "after_char";
  extensions?: Record<string, unknown>;
  /** 关联 .md 文件名（Q5 单向同步源） */
  novelchat?: { sourceDoc?: string; category?: string };
}

export interface Lorebook {
  id: string;
  name?: string;
  description?: string;
  scan_depth?: number; // 默认 20
  token_budget?: number; // 默认 1024
  recursive_scanning?: boolean;
  extensions?: Record<string, unknown>;
  entries: LorebookEntry[];
  novelchat: {
    ownerId: string;
    projectId?: string;
    characterId?: string;
    kind: "project" | "character" | "standalone";
  };
}

export interface RoleplayGroup {
  id: string;
  name: string;
  novelchat: { ownerId: string; projectId: string };
  /** codexId 数组（顺序即 List 轮转序） */
  members: string[];
  disabledMembers: string[];
  /** Q9：MVP 仅 manual | list */
  activationStrategy: "manual" | "list" | "natural" | "pooled";
  generationMode: "swap" | "append";
  scenarioOverride?: string;
  greeting?: string;
  allowSelfResponses: boolean;
}

/**
 * 酒馆预设（FT-22 用，FT-20 先建骨架）。
 * 轻量承载 system 提示模板 + 默认 lorebook 扫描参数，供对话复用。
 */
export interface TavernPreset {
  id: string;
  name?: string;
  /** system 提示模板（覆盖角色卡 system_prompt 的全局基底，可选） */
  systemPromptTemplate?: string;
  /** 默认 lorebook 扫描深度 */
  scanDepth?: number;
  /** 默认 lorebook token 预算 */
  tokenBudget?: number;
  novelchat: { ownerId: string; projectId?: string };
}
