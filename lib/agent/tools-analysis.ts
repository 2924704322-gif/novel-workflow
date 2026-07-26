// D 组工具：拆书学 / 卡库（复用 lib/style·lib/archive 的分析 prompt + storage）。从原 lib/agent/tools.ts 搬来，逻辑未改。

import { completeChat } from "../llm";
import { LLM_MAX_TOKENS } from "../constants";
import {
  buildArchiveAnalyzePrompt,
  buildStyleAnalyzePrompt,
  extractJson,
} from "../prompts";
import { normalizeChunk, type StyleAnalysis } from "../style";
import { normalizeArchiveChunk, type ArchiveAnalysis } from "../archive";
import { listStyleCards, listArchives } from "../storage";
import {
  type AgentTool,
  type ToolArgs,
  type ToolContext,
} from "./tools-shared";

const analyze_style: AgentTool = {
  name: "analyze_style",
  description:
    "对一段文本进行文风分析（单块）。返回七维 StyleAnalysis（sentenceRhythm/vocabulary/descriptionStrategy/dialogueStyle/narrativeStructure/emotionalTone/rhetoric）。客户端通常先分块/采样再逐块调用。",
  group: "D",
  write: false,
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "待分析的文本片段（建议 ≤8000 字）" },
    },
    required: ["text"],
  },
  run: async (args, ctx) => {
    const text = (args.text as string) || "";
    if (!text.trim()) throw new Error("文本片段为空，无法分析文风。");
    const messages = buildStyleAnalyzePrompt(text);
    let lastErr = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await completeChat(ctx.config, messages, { maxTokens: 2048 });
        const json = extractJson(raw);
        return normalizeChunk(json) as StyleAnalysis;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : "分析失败";
      }
    }
    throw new Error(lastErr || "文风分析服务暂时不可用");
  },
};

const analyze_archive: AgentTool = {
  name: "analyze_archive",
  description:
    "对一段文本进行设定拆书分析（单块）。返回 ArchiveAnalysis（title/synopsis/worldbuilding/powerSystem/themes/styleHint/characters/locations/factions/mainPlot）。客户端通常先全量覆盖分块再逐块调用。",
  group: "D",
  write: false,
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "待分析的文本片段（建议 ≤40000 字）" },
    },
    required: ["text"],
  },
  run: async (args, ctx) => {
    const text = (args.text as string) || "";
    if (!text.trim()) throw new Error("文本片段为空，无法分析设定。");
    const messages = buildArchiveAnalyzePrompt(text);
    let lastErr = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await completeChat(ctx.config, messages, { maxTokens: 3200 });
        const json = extractJson(raw);
        return normalizeArchiveChunk(json) as ArchiveAnalysis;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : "分析失败";
      }
    }
    throw new Error(lastErr || "设定分析服务暂时不可用");
  },
};

const list_style_cards: AgentTool = {
  name: "list_style_cards",
  description:
    "列出已保存的全部文风卡（拆书学文风卡库），按创建时间倒序。每张卡含 id/sourceFileName/styleName/signature 等摘要。",
  group: "D",
  write: false,
  parameters: { type: "object", properties: {} },
  run: async () => {
    const cards = await listStyleCards();
    return cards.map((c) => ({
      id: c.id,
      sourceFileHash: c.sourceFileHash,
      sourceFileName: c.sourceFileName,
      createdAt: c.createdAt,
      styleName: c.styleName,
      signature: c.signature,
    }));
  },
};

const list_archives: AgentTool = {
  name: "list_archives",
  description:
    "列出已保存的全部设定档案（拆书学设定卡库），按创建时间倒序。每份档案含 id/sourceFileName/title/synopsis 等摘要。",
  group: "D",
  write: false,
  parameters: { type: "object", properties: {} },
  run: async () => {
    const archives = await listArchives();
    return archives.map((a) => ({
      id: a.id,
      sourceFileHash: a.sourceFileHash,
      sourceFileName: a.sourceFileName,
      createdAt: a.createdAt,
      title: a.title,
      synopsis: a.synopsis.slice(0, 200) + (a.synopsis.length > 200 ? "…" : ""),
      characterCount: a.characters.length,
      locationCount: a.locations.length,
    }));
  },
};

export {
  analyze_style,
  analyze_archive,
  list_style_cards,
  list_archives,
};
