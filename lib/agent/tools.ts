// Agent 工具注册表（系统规范 §3.4）。A/B/C 三组工具，全部映射到 lib/ 中的
// 真实符号：数据经 projectRepository，生成复用 prompt 构造 + completeChat，
// 记忆/检索直调 lib/retrieval 与 lib/reconcile 的纯函数。**不重写小说逻辑。**
//
// 工具分两类（§3.5 Human-in-the-loop）：
//  - write=false：只读 / 生成候选，Agent 可自由调用，run() 立即返回结果。
//  - write=true ：写操作，先 propose() 产出变更提案（不落库），用户确认后 apply()。
//
// 归属：Sub A（后端）。

import type {
  ApiConfig,
  Chapter,
  Project,
  StoryBible,
  Volume,
} from "../types";
import {
  countWords,
  emptyProject,
  enabledPrompts,
  toSummary,
} from "../types";
import { projectRepository } from "../repository";
import { completeChat } from "../llm";
import {
  buildBiblePrompt,
  buildChapterOutlinePrompt,
  buildChapterPrompt,
  buildDigestPrompt,
  buildReconcilePrompt,
  buildStorySoFarPrompt,
  buildVolumeArcPrompt,
  buildVolumeChaptersPrompt,
  buildVolumesPrompt,
  extractJson,
} from "../prompts";
import {
  activeForeshadows,
  applyDigest,
  buildChapterContext,
  flattenChapters,
  priorVolumeArcs,
  selectRelevantCodex,
  volumeChapterDigests,
  type ChapterDigest,
} from "../retrieval";
import {
  applyReconcile,
  collectDownstream,
  type ReconcileChange,
  type ReconcileResult,
} from "../reconcile";

// ---- 工具运行上下文（服务端注入，不来自模型） -------------------------------

export interface ToolContext {
  ownerId: string; // 接缝③/⑤，本地固定 "local"
  config: ApiConfig; // 接缝④，模型与密钥
  projectId?: string; // 当前会话绑定作品（工具参数缺省时回退到它）
}

type ToolArgs = Record<string, any>;

export interface AgentTool {
  name: string;
  description: string;
  group: "A" | "B" | "C";
  write: boolean; // true 时须走确认流（propose → 用户确认 → apply）
  parameters: Record<string, unknown>; // function-calling 的 JSON Schema
  // 只读 / 生成类：立即执行并返回结果。
  run?: (args: ToolArgs, ctx: ToolContext) => Promise<unknown>;
  // 写操作类：产出人类可读的变更摘要 + diff，但不落库。
  propose?: (
    args: ToolArgs,
    ctx: ToolContext
  ) => Promise<{ changeSummary: string; diff?: unknown }>;
  // 写操作类：用户确认后真正落库。args 为 propose 时的同一份入参。
  apply?: (args: ToolArgs, ctx: ToolContext) => Promise<unknown>;
}

// ---- 内部小工具 ------------------------------------------------------------

function rid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function loadProject(ctx: ToolContext, id?: string): Promise<Project> {
  const pid = id || ctx.projectId;
  if (!pid) throw new Error("未指定作品：请提供 projectId 或先选定一本书。");
  const p = await projectRepository.get(ctx.ownerId, pid);
  if (!p) throw new Error(`作品不存在：${pid}`);
  return p;
}

function requireBible(p: Project): StoryBible {
  if (!p.bible) throw new Error("该作品尚无故事设定集（bible），请先调用 generate_bible 并保存。");
  return p.bible;
}

// 某卷在全书中的起始全局章号（1-based）。
function volumeGlobalStart(p: Project, volumeId: string): number {
  let start = 1;
  for (const v of p.volumes) {
    if (v.id === volumeId) break;
    start += v.chapters.length;
  }
  return start;
}

const projectIdParam = {
  projectId: {
    type: "string",
    description: "作品 id；缺省时使用当前会话绑定的作品。",
  },
};

// ---- A. 数据 / 项目（映射 lib/storage 经 Repository） ------------------------

const list_projects: AgentTool = {
  name: "list_projects",
  description: "列出全部作品的摘要（标题、阶段、字数、章节进度）。",
  group: "A",
  write: false,
  parameters: { type: "object", properties: {} },
  run: async (_args, ctx) =>
    (await projectRepository.list(ctx.ownerId)).map(toSummary),
};

const get_project: AgentTool = {
  name: "get_project",
  description: "读取整本作品（含设定集、分卷、章节、设定库、伏笔等）。",
  group: "A",
  write: false,
  parameters: { type: "object", properties: { ...projectIdParam } },
  run: async (args, ctx) => loadProject(ctx, args.projectId),
};

const create_project: AgentTool = {
  name: "create_project",
  description: "新建一本空作品。写操作，需用户确认。",
  group: "A",
  write: true,
  parameters: {
    type: "object",
    properties: { title: { type: "string", description: "作品标题" } },
    required: ["title"],
  },
  propose: async (args) => ({
    changeSummary: `新建空作品「${(args.title as string) || "未命名作品"}」`,
    diff: { title: args.title },
  }),
  apply: async (args, ctx) => {
    const id = rid();
    const p = emptyProject(id, (args.title as string)?.trim() || "未命名作品");
    return projectRepository.save(ctx.ownerId, p);
  },
};

const save_project: AgentTool = {
  name: "save_project",
  description:
    "把一组字段覆盖保存到作品（如 title/phase/bible/volumes/setup/codex/foreshadows/storySoFar）。正文落库、设定集/分卷/章节草稿的持久化都经此工具。写操作，需用户确认。",
  group: "A",
  write: true,
  parameters: {
    type: "object",
    properties: {
      ...projectIdParam,
      patch: {
        type: "object",
        description:
          "要覆盖写入的字段（Partial<Project>）。仅提供需变更的顶层字段即可。",
      },
    },
    required: ["patch"],
  },
  propose: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    const keys = Object.keys((args.patch as object) || {});
    return {
      changeSummary: `保存作品「${p.title}」：更新字段 ${keys.join("、") || "（无）"}`,
      diff: { projectId: p.id, changedKeys: keys },
    };
  },
  apply: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    const merged: Project = {
      ...p,
      ...((args.patch as Partial<Project>) || {}),
      id: p.id,
      createdAt: p.createdAt,
    };
    return projectRepository.save(ctx.ownerId, merged);
  },
};

const delete_project: AgentTool = {
  name: "delete_project",
  description: "删除一本作品（不可恢复）。高危写操作，需用户确认。",
  group: "A",
  write: true,
  parameters: {
    type: "object",
    properties: { ...projectIdParam },
    required: ["projectId"],
  },
  propose: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    return {
      changeSummary: `删除作品「${p.title}」（不可恢复）`,
      diff: { projectId: p.id, title: p.title },
    };
  },
  apply: async (args, ctx) => {
    await projectRepository.delete(ctx.ownerId, args.projectId as string);
    return { ok: true };
  },
};

// ---- B. 生成 / 工作流（复用 prompt 构造 + completeChat） ---------------------

const generate_bible: AgentTool = {
  name: "generate_bible",
  description:
    "根据作品的立意设定生成【故事设定集】（标题/内核/梗概/世界观/主题/文风/人物）。返回候选，不落库；如需保存请再调用 save_project。",
  group: "B",
  write: false,
  parameters: {
    type: "object",
    properties: {
      ...projectIdParam,
      direction: { type: "string", description: "本次生成的调整方向（可空）" },
    },
  },
  run: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    const raw = await completeChat(
      ctx.config,
      buildBiblePrompt(p.setup, args.direction),
      { maxTokens: 8192 }
    );
    return extractJson<{ title?: string; bible: StoryBible }>(raw);
  },
};

const generate_volumes: AgentTool = {
  name: "generate_volumes",
  description:
    "根据故事设定集生成【分卷脉络】。返回已成形的 Volume[]（含 id/序号/空章节数组），可直接作为 save_project 的 patch.volumes 保存。",
  group: "B",
  write: false,
  parameters: {
    type: "object",
    properties: {
      ...projectIdParam,
      direction: { type: "string", description: "本次生成的调整方向（可空）" },
    },
  },
  run: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    const bible = requireBible(p);
    const raw = await completeChat(
      ctx.config,
      buildVolumesPrompt(p.setup, bible, args.direction),
      { maxTokens: 8192 }
    );
    const data = extractJson<{
      volumes: { title: string; summary: string; chapterCount: number }[];
    }>(raw);
    const volumes: Volume[] = (data.volumes || []).map((v, i) => ({
      id: rid(),
      index: i + 1,
      title: v.title,
      summary: v.summary,
      plannedChapters: v.chapterCount || 0,
      chapters: [],
      arcSummary: "",
    }));
    return { volumes };
  },
};

const generate_volume: AgentTool = {
  name: "generate_volume",
  description:
    "把某一卷细化为章节脉络。返回已成形的 Chapter[]（含 id/序号，正文为空）。需把它并入该卷 chapters 后经 save_project 保存。",
  group: "B",
  write: false,
  parameters: {
    type: "object",
    properties: {
      ...projectIdParam,
      volumeId: { type: "string", description: "目标卷 id" },
      chapterCount: { type: "number", description: "章数；缺省用该卷 plannedChapters" },
    },
    required: ["volumeId"],
  },
  run: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    const bible = requireBible(p);
    const v = p.volumes.find((x) => x.id === args.volumeId);
    if (!v) throw new Error("卷不存在。");
    const count = Number(args.chapterCount) || v.plannedChapters || 10;
    const raw = await completeChat(
      ctx.config,
      buildVolumeChaptersPrompt(p.setup, bible, v, count),
      { maxTokens: 8192 }
    );
    const data = extractJson<{ chapters: { title: string; synopsis: string }[] }>(raw);
    const chapters: Chapter[] = (data.chapters || []).map((c, i) => ({
      id: rid(),
      index: i + 1,
      title: c.title,
      synopsis: c.synopsis,
      content: "",
      summary: "",
      wordCount: 0,
      status: "empty",
      updatedAt: Date.now(),
    }));
    return { volumeId: v.id, chapters };
  },
};

const generate_chapter_outline: AgentTool = {
  name: "generate_chapter_outline",
  description:
    "生成单章脉络：mode='next' 续写下一章，mode='regen' 重写 targetIndex 指定章。返回 { title, synopsis }。",
  group: "B",
  write: false,
  parameters: {
    type: "object",
    properties: {
      ...projectIdParam,
      volumeId: { type: "string", description: "目标卷 id" },
      mode: { type: "string", enum: ["next", "regen"], description: "next=续写下一章；regen=重写某章" },
      targetIndex: { type: "number", description: "regen 模式下要重写的卷内章序号" },
      direction: { type: "string", description: "调整方向（可空）" },
    },
    required: ["volumeId"],
  },
  run: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    const bible = requireBible(p);
    const v = p.volumes.find((x) => x.id === args.volumeId);
    if (!v) throw new Error("卷不存在。");
    const raw = await completeChat(
      ctx.config,
      buildChapterOutlinePrompt(p.setup, bible, v, {
        mode: (args.mode as "next" | "regen") || "next",
        targetIndex: args.targetIndex,
        globalStart: volumeGlobalStart(p, v.id),
        direction: args.direction,
      }),
      { maxTokens: 2048 }
    );
    const chapter = extractJson<{ title: string; synopsis: string }>(raw);
    return { volumeId: v.id, chapter };
  },
};

const generate_chapter: AgentTool = {
  name: "generate_chapter",
  description:
    "为指定章节生成/续写正文：先组装三层记忆上下文（build_chapter_context），再据本章细纲写作。返回正文与字数（草稿），落库请经 save_project 写回该章 content。",
  group: "B",
  write: false,
  parameters: {
    type: "object",
    properties: {
      ...projectIdParam,
      chapterId: { type: "string", description: "目标章节 id" },
      direction: { type: "string", description: "写作调整方向（可空）" },
    },
    required: ["chapterId"],
  },
  run: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    const bible = requireBible(p);
    const flat = flattenChapters(p);
    const idx = flat.findIndex((f) => f.chapter.id === args.chapterId);
    if (idx < 0) throw new Error("章节不存在。");
    const f = flat[idx];
    const next = flat[idx + 1]?.chapter ?? null;
    const cctx = buildChapterContext(p, args.chapterId as string);
    const raw = await completeChat(
      ctx.config,
      buildChapterPrompt(
        p.setup,
        bible,
        f.volume,
        f.chapter,
        f.prev,
        cctx,
        f.global,
        args.direction,
        enabledPrompts(p),
        next
      ),
      { maxTokens: 8192 }
    );
    const content = (raw || "").trim();
    return {
      chapterId: f.chapter.id,
      globalNo: f.global,
      content,
      wordCount: countWords(content),
    };
  },
};

const digest_chapter: AgentTool = {
  name: "digest_chapter",
  description:
    "成稿后提炼本章摘要，并抽取设定库/伏笔更新（ChapterDigest）。返回候选 digest；折回请经 apply_digest。",
  group: "B",
  write: false,
  parameters: {
    type: "object",
    properties: {
      ...projectIdParam,
      chapterId: { type: "string", description: "已成稿的章节 id" },
    },
    required: ["chapterId"],
  },
  run: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    const flat = flattenChapters(p);
    const f = flat.find((x) => x.chapter.id === args.chapterId);
    if (!f) throw new Error("章节不存在。");
    const known = p.codex.map((e) => ({ name: e.name, status: e.status }));
    const open = activeForeshadows(p.foreshadows).map((x) => x.title);
    const raw = await completeChat(
      ctx.config,
      buildDigestPrompt(f.chapter, f.chapter.content || "", known, open, f.global),
      { maxTokens: 2048 }
    );
    const digest = extractJson<ChapterDigest>(raw);
    return { chapterId: f.chapter.id, globalNo: f.global, digest };
  },
};

const generate_recap: AgentTool = {
  name: "generate_recap",
  description:
    "生成滚动前情：mode='volume' 归纳某卷至今概述（需 volumeId）；mode='book' 综合已完成分卷为全书 storySoFar。返回 { text }。",
  group: "B",
  write: false,
  parameters: {
    type: "object",
    properties: {
      ...projectIdParam,
      mode: { type: "string", enum: ["volume", "book"] },
      volumeId: { type: "string", description: "mode=volume 时的目标卷 id" },
    },
    required: ["mode"],
  },
  run: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    if (args.mode === "book") {
      const bible = requireBible(p);
      // 传入不匹配任何卷的 id，priorVolumeArcs 会纳入全部有概述的分卷。
      const priorArcs = priorVolumeArcs(p, "__all__");
      const raw = await completeChat(
        ctx.config,
        buildStorySoFarPrompt(bible, priorArcs),
        { maxTokens: 2048 }
      );
      return { mode: "book", text: (raw || "").trim() };
    }
    const v = p.volumes.find((x) => x.id === args.volumeId);
    if (!v) throw new Error("卷不存在。");
    const sums = volumeChapterDigests(p, v.id);
    const raw = await completeChat(
      ctx.config,
      buildVolumeArcPrompt(v, sums, v.arcSummary),
      { maxTokens: 2048 }
    );
    return { mode: "volume", volumeId: v.id, text: (raw || "").trim() };
  },
};

const reconcile: AgentTool = {
  name: "reconcile",
  description:
    "上游内容重生后，审阅下游卷纲/章节脉络/摘要并给出最小必要的一致性校正（ReconcileResult）。只计算不落库；折回请经 apply_reconcile。绝不改写已写正文。",
  group: "B",
  write: false,
  parameters: {
    type: "object",
    properties: {
      ...projectIdParam,
      change: {
        type: "object",
        description:
          "ReconcileChange：{ origin:'bible'|'chapter-outline'|'prose', label, detail, direction? }",
      },
      fromGlobal: { type: "number", description: "仅校正该全局章号及其后的章节（可空）" },
    },
    required: ["change"],
  },
  run: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    const change = args.change as ReconcileChange;
    const payload = collectDownstream(p, {
      fromGlobal: args.fromGlobal,
      includeAllVolumes: change.origin === "bible",
    });
    const raw = await completeChat(
      ctx.config,
      buildReconcilePrompt(change, payload, p.bible ?? null),
      { maxTokens: 4096 }
    );
    return extractJson<ReconcileResult>(raw);
  },
};

// ---- C. 记忆 / 检索（直调 lib/retrieval 纯函数） ----------------------------

const build_chapter_context: AgentTool = {
  name: "build_chapter_context",
  description:
    "为某章组装三层滚动记忆（storySoFar/volumeArc/近章摘要）+ 相关设定档案 + 活跃伏笔。写正文前应先调用它拿到 ctx。",
  group: "C",
  write: false,
  parameters: {
    type: "object",
    properties: {
      ...projectIdParam,
      chapterId: { type: "string", description: "目标章节 id" },
    },
    required: ["chapterId"],
  },
  run: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    return buildChapterContext(p, args.chapterId as string);
  },
};

const query_codex: AgentTool = {
  name: "query_codex",
  description: "按一段文本检索相关的世界档案条目（确定性多因子匹配，核心角色恒定注入）。",
  group: "C",
  write: false,
  parameters: {
    type: "object",
    properties: {
      ...projectIdParam,
      text: { type: "string", description: "用于匹配的查询文本" },
      limit: { type: "number", description: "返回条目上限，默认 14" },
    },
    required: ["text"],
  },
  run: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    const core = (p.bible?.characters || []).map((c) => c.name).filter(Boolean);
    return selectRelevantCodex(
      p.codex,
      (args.text as string) || "",
      0,
      core,
      Number(args.limit) || 14
    );
  },
};

const apply_digest: AgentTool = {
  name: "apply_digest",
  description:
    "把某章的 digest 折回作品：写入章节摘要、按名合并设定库、按标题合并伏笔。写操作，需用户确认。",
  group: "C",
  write: true,
  parameters: {
    type: "object",
    properties: {
      ...projectIdParam,
      chapterId: { type: "string", description: "目标章节 id" },
      digest: { type: "object", description: "digest_chapter 返回的 ChapterDigest" },
    },
    required: ["chapterId", "digest"],
  },
  propose: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    const d = (args.digest as ChapterDigest) || {};
    const f = flattenChapters(p).find((x) => x.chapter.id === args.chapterId);
    const no = f ? `第${f.global}章` : "该章";
    const codexNames = (d.codex || []).map((c) => c.name).filter(Boolean);
    const fs = (d.foreshadows || []).map((x) => x.title).filter(Boolean);
    return {
      changeSummary: `将 ${no} 归档折回作品「${p.title}」：更新章节摘要、${codexNames.length} 条设定、${fs.length} 条伏笔`,
      diff: { chapterId: args.chapterId, summary: d.summary, codex: codexNames, foreshadows: fs },
    };
  },
  apply: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    const np = applyDigest(p, args.chapterId as string, args.digest as ChapterDigest);
    return projectRepository.save(ctx.ownerId, np);
  },
};

const apply_reconcile: AgentTool = {
  name: "apply_reconcile",
  description:
    "把一致性校正结果折回作品（更新卷纲/章节脉络/标题/摘要）。绝不改写已写正文。写操作，需用户确认。",
  group: "C",
  write: true,
  parameters: {
    type: "object",
    properties: {
      ...projectIdParam,
      result: { type: "object", description: "reconcile 返回的 ReconcileResult" },
    },
    required: ["result"],
  },
  propose: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    const r = (args.result as ReconcileResult) || { changeSummary: "", updates: [] };
    return {
      changeSummary:
        (r.changeSummary && r.changeSummary.trim()) ||
        `折回一致性校正到作品「${p.title}」：${(r.updates || []).length} 处更新`,
      diff: {
        updates: (r.updates || []).map((u) => ({ kind: u.kind, id: u.volumeId || u.chapterId })),
        staleProse: r.staleProse || [],
      },
    };
  },
  apply: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    const np = applyReconcile(p, args.result as ReconcileResult);
    return projectRepository.save(ctx.ownerId, np);
  },
};

// ---- 注册表 ----------------------------------------------------------------

export const AGENT_TOOLS: AgentTool[] = [
  // A. 数据 / 项目
  list_projects,
  get_project,
  create_project,
  save_project,
  delete_project,
  // B. 生成 / 工作流
  generate_bible,
  generate_volumes,
  generate_volume,
  generate_chapter_outline,
  generate_chapter,
  digest_chapter,
  generate_recap,
  reconcile,
  // C. 记忆 / 检索
  build_chapter_context,
  query_codex,
  apply_digest,
  apply_reconcile,
];

export const TOOLS_BY_NAME: Record<string, AgentTool> = Object.fromEntries(
  AGENT_TOOLS.map((t) => [t.name, t])
);

// OpenAI 兼容 function-calling 的工具声明（供 chat/completions 的 tools 字段）。
export function toolSchemas() {
  return AGENT_TOOLS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
