// C 组工具：记忆 / 检索（直调 lib/retrieval 纯函数）。从原 lib/agent/tools.ts 搬来，逻辑未改。

import { projectRepository } from "../repository";
import {
  applyDigest,
  buildChapterContext,
  flattenChapters,
  selectRelevantCodex,
  type ChapterDigest,
} from "../retrieval";
import { applyReconcile, type ReconcileResult } from "../reconcile";
import {
  type AgentTool,
  type ToolArgs,
  type ToolContext,
  loadProject,
  projectIdParam,
} from "./tools-shared";

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

export {
  build_chapter_context,
  query_codex,
  apply_digest,
  apply_reconcile,
};
