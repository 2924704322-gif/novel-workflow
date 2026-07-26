// B 组工具：生成 / 工作流（复用 prompt 构造 + completeChat）。从原 lib/agent/tools.ts 搬来，逻辑未改。

import type { Chapter, StoryBible, Volume } from "../types";
import { countWords, enabledPrompts } from "../types";
import { completeChat } from "../llm";
import { LLM_MAX_TOKENS } from "../constants";
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
  buildChapterContext,
  flattenChapters,
  priorVolumeArcs,
  volumeChapterDigests,
  type ChapterDigest,
} from "../retrieval";
import {
  collectDownstream,
  type ReconcileChange,
  type ReconcileResult,
} from "../reconcile";
import {
  type AgentTool,
  type ToolArgs,
  type ToolContext,
  loadProject,
  projectIdParam,
  remember,
  requireBible,
  rid,
  volumeGlobalStart,
} from "./tools-shared";

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
      { maxTokens: LLM_MAX_TOKENS }
    );
    const result = extractJson<{ title?: string; bible: StoryBible }>(raw);
    remember(ctx, "bible", result);
    return result;
  },
};


const generate_volumes: AgentTool = {
  name: "generate_volumes",
  description:
    "根据故事设定集生成【分卷脉络】。返回已成形的 Volume[]（含 id/序号/空章节数组）。落库请调用 save_project 并设 fromGenerated:['volumes']。",
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
      { maxTokens: LLM_MAX_TOKENS }
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
    const out = { volumes };
    remember(ctx, "volumes", out);
    return out;
  },
};

const generate_volume: AgentTool = {
  name: "generate_volume",
  description:
    "把某一卷细化为章节脉络。返回已成形的 Chapter[]（含 id/序号，正文为空）。落库请调用 save_project 并设 fromGenerated:['volume']（平台会自动并入该卷 chapters）。",
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
      { maxTokens: LLM_MAX_TOKENS }
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
    const out = { volumeId: v.id, chapters };
    remember(ctx, "volume", out);
    return out;
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
    const out = { volumeId: v.id, chapter };
    remember(ctx, "chapter_outline", out);
    return out;
  },
};

const generate_chapter: AgentTool = {
  name: "generate_chapter",
  description:
    "为指定章节生成/续写正文：先组装三层记忆上下文（build_chapter_context），再据本章细纲写作。返回正文与字数（草稿）。落库请调用 save_project 并设 fromGenerated:['chapter']（平台会自动写回该章 content）。",
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
      { maxTokens: LLM_MAX_TOKENS }
    );
    const content = (raw || "").trim();
    const out = {
      chapterId: f.chapter.id,
      globalNo: f.global,
      content,
      wordCount: countWords(content),
    };
    remember(ctx, "chapter", out);
    return out;
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
      const out = { mode: "book", text: (raw || "").trim() };
      remember(ctx, "recap", out);
      return out;
    }
    const v = p.volumes.find((x) => x.id === args.volumeId);
    if (!v) throw new Error("卷不存在。");
    const sums = volumeChapterDigests(p, v.id);
    const raw = await completeChat(
      ctx.config,
      buildVolumeArcPrompt(v, sums, v.arcSummary),
      { maxTokens: 2048 }
    );
    const out = { mode: "volume", volumeId: v.id, text: (raw || "").trim() };
    remember(ctx, "recap", out);
    return out;
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

export {
  generate_bible,
  generate_volumes,
  generate_volume,
  generate_chapter_outline,
  generate_chapter,
  digest_chapter,
  generate_recap,
  reconcile,
};
