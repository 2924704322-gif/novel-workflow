// 工具运行上下文、类型、生成候选折叠逻辑与内部小工具（被各分组子文件复用）。
//
// 从原 lib/agent/tools.ts 搬来，逻辑与字符串逐字保留，未做任何改动。
// 本文件仅对 lib/agent/tools 内部可见：lib/agent/tools.ts（barrel）只再导出
// 公共符号（ToolContext / GeneratedEntry / GeneratedCache / AgentTool / foldGenerated），
// 内部小工具不进入公共 API。

import type { ApiConfig, Chapter, Project, StoryBible, Volume } from "../types";
import { countWords } from "../types";
import { projectRepository } from "../repository";

// ---- 工具运行上下文（服务端注入，不来自模型） -------------------------------

export interface ToolContext {
  ownerId: string; // 接缝③/⑤，本地固定 "local"
  config: ApiConfig; // 接缝④，模型与密钥
  projectId?: string; // 当前会话绑定作品（工具参数缺省时回退到它）
  // 本轮生成候选缓存（服务端注入，跨工具共享）：generate_* 写入，save_project 折回落库。
  // 使模型无需把生成的大 JSON 复制进 save_project.patch，规避 function-calling 中继丢失。
  generated?: GeneratedCache;
}

// 一条已生成候选：按类型（bible/volumes/volume/chapter/chapter_outline/recap）缓存本轮产物。
export interface GeneratedEntry {
  kind: string;
  payload: unknown;
  at: number;
}
export type GeneratedCache = Record<string, GeneratedEntry>;

export type ToolArgs = Record<string, any>;

export interface AgentTool {
  name: string;
  description: string;
  group: "A" | "B" | "C" | "D";
  write: boolean; // true 时须走确认流（propose → 用户确认 → apply）
  parameters: Record<string, unknown>; // function-calling 的 JSON Schema
  // 只读 / 生成类：立即执行并返回结果。
  run?: (args: ToolArgs, ctx: ToolContext) => Promise<unknown>;
  // 写操作类：产出人类可读的变更摘要 + diff，但不落库。
  // argsPatch（可选）：回填确认落库所需的确定性字段（如预分配 id），
  // runtime 会把它并入 proposal.args，使 apply 幂等。
  propose?: (
    args: ToolArgs,
    ctx: ToolContext
  ) => Promise<{ changeSummary: string; diff?: unknown; argsPatch?: Record<string, any> }>;
  // 写操作类：用户确认后真正落库。args 为 propose 时的同一份入参。
  apply?: (args: ToolArgs, ctx: ToolContext) => Promise<unknown>;
}

// ---- 内部小工具 ------------------------------------------------------------

export function rid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function loadProject(ctx: ToolContext, id?: string): Promise<Project> {
  const pid = id || ctx.projectId;
  if (!pid) throw new Error("未指定作品：请提供 projectId 或先选定一本书。");
  const p = await projectRepository.get(ctx.ownerId, pid);
  if (!p) throw new Error(`作品不存在：${pid}`);
  return p;
}

export function requireBible(p: Project): StoryBible {
  if (!p.bible) throw new Error("该作品尚无故事设定集（bible），请先调用 generate_bible 并保存。");
  return p.bible;
}

// 某卷在全书中的起始全局章号（1-based）。
export function volumeGlobalStart(p: Project, volumeId: string): number {
  let start = 1;
  for (const v of p.volumes) {
    if (v.id === volumeId) break;
    start += v.chapters.length;
  }
  return start;
}

// 记本轮某类生成候选到共享缓存，供 save_project 折回落库（避免模型中继大 JSON）。
export function remember(ctx: ToolContext, kind: string, payload: unknown): void {
  if (!ctx.generated) return;
  ctx.generated[kind] = { kind, payload, at: Date.now() };
}

// 把本轮已生成候选按类型折进一个 Partial<Project> 补丁（服务端合并，含分卷/章节等
// 嵌套写回），返回补丁与变更的顶层字段名。save_project.propose 据此生成摘要并把
// 补丁固化进 proposal.args，apply 时直接覆盖落库——模型全程无需复制生成的 JSON。
// 导出以便纯函数单测（墨章测试安全网 P1-3）；函数本身逻辑未改动。
export function foldGenerated(
  p: Project,
  cache: GeneratedCache,
  kinds: string[]
): { patch: Partial<Project>; keys: string[] } {
  const patch: Partial<Project> = {};
  const keys: string[] = [];
  let volumes: Volume[] | null = null; // 惰性深拷贝，多个 kind 可累积改动
  const editVolumes = (): Volume[] => {
    if (!volumes) {
      const base = (patch.volumes as Volume[] | undefined) || p.volumes;
      volumes = base.map((v) => ({ ...v, chapters: v.chapters.map((c) => ({ ...c })) }));
    }
    return volumes;
  };
  const markVolumes = () => {
    if (!keys.includes("volumes")) keys.push("volumes");
  };

  for (const kind of kinds) {
    const e = cache[kind];
    if (!e) continue;
    const pl = e.payload as any;
    if (kind === "bible") {
      patch.bible = (pl.bible ?? pl) as StoryBible;
      if (!keys.includes("bible")) keys.push("bible");
      if (typeof pl.title === "string" && pl.title.trim()) {
        patch.title = pl.title.trim();
        if (!keys.includes("title")) keys.push("title");
      }
    } else if (kind === "volumes") {
      patch.volumes = (pl.volumes ?? pl) as Volume[];
      markVolumes();
    } else if (kind === "volume") {
      const vols = editVolumes();
      const v = vols.find((x) => x.id === pl.volumeId);
      if (v) v.chapters = (pl.chapters as Chapter[]) || [];
      markVolumes();
    } else if (kind === "chapter_outline") {
      const vols = editVolumes();
      const v = vols.find((x) => x.id === pl.volumeId);
      const ch = pl.chapter || {};
      if (v) {
        v.chapters = [
          ...v.chapters,
          {
            id: rid(),
            index: v.chapters.length + 1,
            title: ch.title || "",
            synopsis: ch.synopsis || "",
            content: "",
            summary: "",
            wordCount: 0,
            status: "empty",
            updatedAt: Date.now(),
          },
        ];
      }
      markVolumes();
    } else if (kind === "chapter") {
      const vols = editVolumes();
      for (const v of vols) {
        const c = v.chapters.find((x) => x.id === pl.chapterId);
        if (c) {
          c.content = pl.content || "";
          c.wordCount = pl.wordCount || countWords(c.content);
          c.status = c.content ? "draft" : c.status;
          c.updatedAt = Date.now();
          break;
        }
      }
      markVolumes();
    } else if (kind === "recap") {
      if (pl.mode === "book") {
        patch.storySoFar = pl.text || "";
        if (!keys.includes("storySoFar")) keys.push("storySoFar");
      } else {
        const vols = editVolumes();
        const v = vols.find((x) => x.id === pl.volumeId);
        if (v) v.arcSummary = pl.text || "";
        markVolumes();
      }
    }
  }
  if (volumes) patch.volumes = volumes;
  return { patch, keys };
}

export const projectIdParam = {
  projectId: {
    type: "string",
    description: "作品 id；缺省时使用当前会话绑定的作品。",
  },
};
