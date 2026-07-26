// 作品档案（archive）提示词构造。从原 lib/prompts.ts 搬来，逻辑未改。

import type { ChatMessage } from "../llm";
import { SYSTEM_ARCHIVE_ANALYST, SYSTEM_ARCHIVE_REDUCER } from "./shared";

/**
 * Analyze one text chunk for story-archive material (world/characters/plot).
 * Each chunk sees only part of the book; lib/archive.ts merges chunks into one
 * StoryArchive. Returns JSON (snake_case).
 */
export function buildArchiveAnalyzePrompt(text: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_ARCHIVE_ANALYST },
    {
      role: "user",
      content: `请阅读以下小说片段，抽取可用于二创的作品档案。本片段是一部长篇小说的其中一段（按阅读顺序切分），请只依据本片段实际出现的信息抽取，不要臆造、不要套用其他作品、也不要脑补本段之外的情节；人名、地名、事件必须是本片段中真实出现的。本片段未涉及的维度留空字符串或空数组；若本片段为乱码、目录、版权页或无意义字符，请将所有字段置空。

【抽取维度】
1. 作品名（若片段中可推断，否则留空）
2. 整体剧情概述（基于本片段可知的剧情）
3. 世界观设定：时代背景、地理、社会结构、核心设定
4. 力量体系 / 世界规则：修炼/魔法/科技等等级与规则（无则留空）
5. 核心主题与情感基调
6. 文风与叙事特色的简要提示
7. 主要人物：姓名、定位（主角/反派/重要配角）、别名、小传（身份/性格/目标/关系）
8. 关键地点与势力：名称与简介
9. 主线剧情脉络：按时序列出本片段中真实发生的关键事件（尽量完整覆盖本段情节推进，勿遗漏后半段）

【输出格式】
严格输出以下 JSON 结构，不要添加任何额外字段或说明文字：

{
  "title": "作品名（推断，无则留空）",
  "synopsis": "整体剧情概述",
  "worldbuilding": "世界观设定",
  "power_system": "力量体系 / 世界规则（无则留空）",
  "themes": "核心主题与情感基调",
  "style_hint": "文风与叙事特色提示",
  "characters": [ { "name": "人物名", "role": "主角/反派/重要配角", "aliases": ["别名"], "profile": "身份、性格、目标、关系" } ],
  "locations": [ { "name": "地点名", "note": "简介" } ],
  "factions": [ { "name": "势力名", "note": "简介" } ],
  "main_plot": ["按时序的关键剧情事件1", "事件2"]
}

【文本片段】
${text}`,
    },
  ];
}

/**
 * Second-pass "reduce": synthesize a coherent whole-book synopsis / worldbuilding
 * / themes and CONDENSE the scattered per-chunk plot points into a small set of
 * chapter/stage-level key beats. `material` is compiled by lib/archive.ts from
 * all per-chunk analyses. Returns JSON (snake_case).
 */
export function buildArchiveReducePrompt(material: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_ARCHIVE_REDUCER },
    {
      role: "user",
      content: `下面是从一部长篇小说的各个连续段落中分别抽取出的零散信息（按阅读顺序排列）。请综合全部信息，输出对【整本书】的统一理解，不要只依据某一段，也不要臆造素材中未提供的情节。

【要求】
1. synopsis：整体剧情概述，300到500字，讲清开端→发展→高潮→结局的主干与核心矛盾，体现作品真正的主题与基调，不要停留在开头。
2. worldbuilding：综合所有片段，给出连贯的世界观设定（时代背景、地理、社会结构、核心规则），去除重复与矛盾。
3. power_system：力量体系 / 世界规则（无则留空）。
4. themes：核心主题与情感基调。
5. style_hint：文风与叙事特色。
6. main_plot：把零散事件按阶段 / 章节归纳精炼为 8到16 条主线关键节点，每条概括一个阶段的核心冲突与推进，合并重复、剔除琐碎流水账，按时序排列。

【输出格式】
严格输出以下 JSON 结构，不要添加任何额外字段或说明文字：

{
  "synopsis": "整体剧情概述（300-500字）",
  "worldbuilding": "连贯的世界观设定",
  "power_system": "力量体系 / 世界规则（无则留空）",
  "themes": "核心主题与情感基调",
  "style_hint": "文风与叙事特色",
  "main_plot": ["阶段关键节点1", "阶段关键节点2"]
}

【待综合的素材】
${material}`,
    },
  ];
}
