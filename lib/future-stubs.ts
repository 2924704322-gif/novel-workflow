// 未来功能接口预留（类型 + 空函数骨架）。
//
// 各接口仅定义契约，尚未实现。调用时抛出 NotImplemented 错误。
// 未来启用对应功能时，在各自独立模块中实现并替换此处导出即可。

import type { CodexEntry } from "./types";

// ---- 向量检索 / 语义召回 ----

export interface EmbeddingProvider {
  /** 将文本编码为向量。 */
  embed(text: string): Promise<number[]>;
  /** 语义搜索，返回 topK 个最相关条目。 */
  search(query: string, topK: number): Promise<{ id: string; score: number }[]>;
}

/** 创建嵌入提供者实例（未来用 transformers.js 实现）。 */
export function createEmbeddingProvider(): EmbeddingProvider {
  throw new Error("NotImplemented: 向量检索尚未启用，需引入 transformers.js");
}

// ---- 多人物关系图谱 / 时间线 ----

export interface RelationEdge {
  from: string; // codexId
  to: string; // codexId
  label: string; // 关系描述
  weight: number; // 关系强度 0-1
}

export interface TimelineEvent {
  chapter: number; // 全局章号
  codexId: string; // 关联实体
  event: string; // 事件描述
  timestamp: number; // 逻辑时间戳（章号即序）
}

/** 从设定库构建角色关系图（未来实现）。 */
export function buildRelationGraph(codex: CodexEntry[]): RelationEdge[] {
  throw new Error("NotImplemented: 关系图谱功能尚未实现");
}

/** 从设定库构建事件时间线（未来实现）。 */
export function buildTimeline(codex: CodexEntry[]): TimelineEvent[] {
  throw new Error("NotImplemented: 时间线视图功能尚未实现");
}

// ---- 服务端配置加密存储 ----

export interface SecretStore {
  get(ownerId: string, key: string): Promise<string | null>;
  set(ownerId: string, key: string, value: string): Promise<void>;
  delete(ownerId: string, key: string): Promise<void>;
}

/** 创建密钥库实例（未来实现服务端加密存储）。 */
export function createSecretStore(): SecretStore {
  throw new Error(
    "NotImplemented: 服务端密钥库尚未启用，当前使用客户端 localStorage"
  );
}

// ---- better-sqlite3 存储层 ----

export interface SqliteRepository {
  query<T>(sql: string, params?: any[]): Promise<T[]>;
  run(sql: string, params?: any[]): Promise<void>;
}

/** 创建 SQLite 仓库实例（未来实现）。 */
export function createSqliteRepository(): SqliteRepository {
  throw new Error("NotImplemented: SQLite 存储尚未启用，当前使用 JSON 文件");
}
