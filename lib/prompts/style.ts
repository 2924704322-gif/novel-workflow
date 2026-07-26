// 文风分析（style）提示词构造。从原 lib/prompts.ts 搬来，逻辑未改。

import type { ChatMessage } from "../llm";
import { SYSTEM_STYLE_ANALYST } from "./shared";

/**
 * Analyze one text chunk across 7 stylistic dimensions. Returns JSON (snake_case)
 * that lib/style.ts normalizes and merges across chunks.
 */
export function buildStyleAnalyzePrompt(text: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_STYLE_ANALYST },
    {
      role: "user",
      content: `请阅读以下文本片段，从 7 个维度进行精确分析，并汇总为一条可执行的“模仿指南”，输出结构化的文风规则卡。分析必须严格基于下方给出的文本本身，不得自行想象或套用其他作品；若本片段为乱码、无意义字符或非小说正文，请将各字段置空。examples 内的例句必须“逐字”摘自下方文本片段，不得改写、翻译或虚构。

【分析维度】
1. 句式节奏：平均句长（字/句）、长短句比例、断句与标点使用习惯（如逗号碎句、短句堆叠、破折号/省略号偏好）
2. 词汇特征：10个高频特色词汇及其语体色彩（文言/口语/书面/网络）、三个禁用词。高频词与禁用词都只取能体现风格的实词（动词/形容词/副词/意象名词等），严禁包含人名、角色名、地名、称谓（如哥哥、姐姐、师父、老板等亲属或身份称呼）及其他专有名词
3. 描写策略：动作描写与心理描写的比例、感官细节使用偏好（视觉/听觉/触觉/嗅觉）
4. 对话风格：口语化程度（1-10分）、潜台词密度（高/中/低）、对话标签使用习惯
5. 叙事结构：叙事视角（第一/第三人称）、时间线处理方式（线性/插叙/倒叙）
6. 情绪基调：整体情绪色彩、情绪表达方式是“展示”还是“告知”
7. 修辞偏好：比喻/拟人/通感等修辞的使用频率和典型模式
最后，综合以上维度写一条“模仿指南”（signature）：用1-2句话概括“如何才能写出这种文风”的可执行要点，供后续模仿时直接遵循。

【输出格式】
严格输出以下 JSON 结构，不要添加任何额外字段或说明文字：

{
  "style_name": "风格名称（由你根据分析结果命名）",
  "signature": "模仿指南：1-2句可执行的风格复刻要点",
  "sentence_rhythm": { "avg_length": "平均句长（数字+字）", "pattern": "长短句节奏与标点断句特征描述", "examples": ["原文例句1", "原文例句2"] },
  "vocabulary": { "high_freq_words": ["共10个高频风格词，不得为人名/地名/称谓/专有名词"], "register": "语体色彩描述", "forbidden_words": ["词1（不得为人名/地名/称谓/专有名词）", "词2", "词3"] },
  "description_strategy": { "action_vs_psychology": "动作:心理 的比例", "sensory_preference": "感官偏好描述" },
  "dialogue_style": { "colloquial_score": 7, "subtext_density": "高/中/低", "tag_habit": "对话标签使用习惯描述" },
  "narrative_structure": { "perspective": "叙事视角", "timeline": "时间线处理方式" },
  "emotional_tone": { "tone": "情绪基调", "expression_mode": "展示/告知" },
  "rhetoric": { "preferred_types": ["修辞类型1", "修辞类型2"], "frequency": "高频/中频/低频", "examples": ["原文例句1"] }
}

【文本片段】
${text}`,
    },
  ];
}
