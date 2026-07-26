// 故事设定集（bible）提示词构造。从原 lib/prompts.ts 搬来，逻辑未改。

import type { ProjectSetup, StoryBible } from "../types";
import type { ChatMessage } from "../llm";
import {
  SYSTEM_PLANNER,
  creativeIntent,
  regenDirectionBlock,
  setupBlock,
} from "./shared";

/** Step 1: story bible only (no volumes). Model returns JSON. */
export function buildBiblePrompt(
  setup: ProjectSetup,
  direction?: string
): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PLANNER },
    {
      role: "user",
      content: `请为下面这部小说设计【故事设定集】（本步骤只产出整体设定，暂不规划分卷）。

${setupBlock(setup)}

${creativeIntent(setup)}
${regenDirectionBlock(direction)}
请输出如下结构的 JSON（字段务必齐全）：
{
  "title": "小说标题",
  "bible": {
    "logline": "一句话故事内核（30字内）",
    "synopsis": "整体故事梗概（400-600字，交代起承转合与最终走向）",
    "worldbuilding": "世界观与核心设定（力量体系、时代背景、关键规则等，300字以上）",
    "themes": "核心主题与情感基调",
    "tone": "叙事文风、人称视角、语言特色",
    "characters": [
      { "name": "人物名", "role": "主角/女主/反派/重要配角", "profile": "一句话人物小传，含身份、性格、目标" }
    ]
  }
}

要求：
1. 人物列出 5-10 位核心角色，覆盖主角、对手与关键配角。
2. 设定内部自洽，为后续分卷与百万字连载留出足够的矛盾与成长空间。
3. 只输出 JSON。`,
    },
  ];
}
