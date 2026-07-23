// Utilities for the "拆书学文风" (style analyzer) feature. Pure, dependency-free
// helpers shared by the client page and the API route: text chunking, even
// sampling, a deterministic content hash for caching, and a merge that folds
// several per-chunk analyses into one StyleCard. No Node-only APIs here so the
// browser can chunk/sample/merge locally and only call the model per chunk.

import type { StyleCard } from "./types";

export const MIN_TEXT_LEN = 1000; // 少于此字数无法有效分析
export const DEFAULT_CHUNK_SIZE = 8000; // 每块约 8000 字，稳妥不超上下文
export const DEFAULT_MAX_CHUNKS = 8; // 采样上限：最多分析这么多块（文风足够）
// 拆设定需要覆盖全书（否则中后期剧情/人物丢失），改用全量覆盖策略：
// 相邻块合并成若干个连续大块，保证 100% 覆盖、无跳过。分组同时受两个上限约束：
// ① 单组字数不超过 ARCHIVE_GROUP_CHARS（防止单次调用撞爆模型上下文）；
// ② 总分组数不超过 ARCHIVE_HARD_MAX_CHUNKS（防止超大文本产生海量模型调用）。
// 两者冲突时（极大文本）以分组数上限为准，单组字数会相应变大（优雅降级）。
export const ARCHIVE_MAX_CHUNKS = 80; // 中小体量：不超过此数时逐块分析（每块一次调用）
export const ARCHIVE_GROUP_CHARS = 40000; // 单次分析调用的输入字数预算（稳妥不超主流长上下文）
export const ARCHIVE_HARD_MAX_CHUNKS = 200; // 分组数硬上限（即最大模型调用次数）

// The camelCase analysis payload (a StyleCard without its metadata fields).
export type StyleAnalysis = Omit<
  StyleCard,
  "id" | "sourceFileHash" | "sourceFileName" | "createdAt"
>;

/** FNV-1a 32-bit hash over the text, hex string. Enough for cache dedup. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // fold length in too, so different-length same-prefix texts differ
  h ^= text.length;
  return (h >>> 0).toString(16).padStart(8, "0");
}

// 空白文风卡：供「自定义文风」按框架手动填写。无源文件，故用 custom- 前缀
// 的合成哈希作为缓存键（与拆书生成的卡同库共存、互不冲突）。
export function blankStyleCard(): StyleCard {
  const seed = `${Date.now()}-${Math.random()}`;
  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    sourceFileHash: `custom-${hashText(seed)}`,
    sourceFileName: "自定义",
    createdAt: Date.now(),
    styleName: "自定义文风",
    signature: "",
    sentenceRhythm: { avgLength: "", pattern: "", examples: [] },
    vocabulary: { highFreqWords: [], register: "", forbiddenWords: [] },
    descriptionStrategy: { actionVsPsychology: "", sensoryPreference: "" },
    dialogueStyle: { colloquialScore: 5, subtextDensity: "", tagHabit: "" },
    narrativeStructure: { perspective: "", timeline: "" },
    emotionalTone: { tone: "", expressionMode: "" },
    rhetoric: { preferredTypes: [], frequency: "", examples: [] },
  };
}

/**
 * Split text into ~size-char chunks along paragraph boundaries so each block
 * stays semantically whole. Oversized single paragraphs are hard-split.
 */
export function chunkText(text: string, size = DEFAULT_CHUNK_SIZE): string[] {
  const paras = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = "";
  };
  for (const p of paras) {
    if (p.length > size) {
      flush();
      for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size));
      continue;
    }
    if (buf.length + p.length + 1 > size) flush();
    buf += (buf ? "\n" : "") + p;
  }
  flush();
  return chunks;
}

/** Evenly pick up to `max` chunks (always including the first) for sampling. */
export function sampleChunks<T>(chunks: T[], max = DEFAULT_MAX_CHUNKS): T[] {
  if (chunks.length <= max) return chunks;
  const out: T[] = [];
  const step = (chunks.length - 1) / (max - 1);
  const seen = new Set<number>();
  for (let i = 0; i < max; i++) {
    const idx = Math.round(i * step);
    if (!seen.has(idx)) {
      seen.add(idx);
      out.push(chunks[idx]);
    }
  }
  return out;
}

/**
 * Guarantee FULL-text coverage: fold adjacent chunks into at most `max`
 * contiguous groups that together contain EVERY chunk (nothing dropped). Unlike
 * sampleChunks (which skips content between samples), this is used by the
 * archive extractor so late-book plot / characters / settings are never lost.
 * Each group is a contiguous span joined back into one string.
 */
export function coverChunks(
  chunks: string[],
  max = ARCHIVE_MAX_CHUNKS
): string[] {
  if (chunks.length <= max) return chunks;
  // 大体量书：同时限制单组字数与总分组数。优先用“字数预算”推算
  // 分组数（文件越大→分组越多→调用越多，而非把每组撞大）；再受硬上限封顶。
  const maxChunksPerGroup = Math.max(
    1,
    Math.floor(ARCHIVE_GROUP_CHARS / DEFAULT_CHUNK_SIZE)
  );
  let groupCount = Math.ceil(chunks.length / maxChunksPerGroup);
  groupCount = Math.min(groupCount, ARCHIVE_HARD_MAX_CHUNKS);
  groupCount = Math.max(groupCount, max); // 不少于原有分组数下限
  const per = Math.ceil(chunks.length / groupCount);
  const groups: string[] = [];
  for (let i = 0; i < chunks.length; i += per) {
    groups.push(chunks.slice(i, i + per).join("\n"));
  }
  return groups;
}

// ---- normalization + merge -------------------------------------------------

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}
function arr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(s).filter(Boolean);
}

/** Map one model result (snake_case, possibly partial) to a StyleAnalysis. */
export function normalizeChunk(raw: unknown): StyleAnalysis {
  const r = (raw || {}) as Record<string, unknown>;
  const g = (k: string) => (r[k] || {}) as Record<string, unknown>;
  const sr = g("sentence_rhythm");
  const vo = g("vocabulary");
  const ds = g("description_strategy");
  const dl = g("dialogue_style");
  const ns = g("narrative_structure");
  const et = g("emotional_tone");
  const rh = g("rhetoric");
  const score = Number(dl.colloquial_score);
  return {
    styleName: s(r.style_name),
    signature: s(r.signature),
    sentenceRhythm: {
      avgLength: s(sr.avg_length),
      pattern: s(sr.pattern),
      examples: arr(sr.examples),
    },
    vocabulary: {
      highFreqWords: arr(vo.high_freq_words),
      register: s(vo.register),
      forbiddenWords: arr(vo.forbidden_words),
    },
    descriptionStrategy: {
      actionVsPsychology: s(ds.action_vs_psychology),
      sensoryPreference: s(ds.sensory_preference),
    },
    dialogueStyle: {
      colloquialScore: Number.isFinite(score) ? score : 0,
      subtextDensity: s(dl.subtext_density),
      tagHabit: s(dl.tag_habit),
    },
    narrativeStructure: {
      perspective: s(ns.perspective),
      timeline: s(ns.timeline),
    },
    emotionalTone: { tone: s(et.tone), expressionMode: s(et.expression_mode) },
    rhetoric: {
      preferredTypes: arr(rh.preferred_types),
      frequency: s(rh.frequency),
      examples: arr(rh.examples),
    },
  };
}

function firstNonEmpty(vals: string[]): string {
  return vals.find((v) => v && v.trim()) || "";
}
/** Pick the longest non-empty string (most detailed) — used for synthesized fields. */
function longest(vals: string[]): string {
  return vals.reduce(
    (best, v) => (v && v.trim().length > best.length ? v.trim() : best),
    ""
  );
}
function majority(vals: string[]): string {
  const count = new Map<string, number>();
  for (const v of vals) {
    if (!v) continue;
    count.set(v, (count.get(v) || 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [k, n] of count) if (n > bestN) [best, bestN] = [k, n];
  return best;
}
function unionCap(lists: string[][], cap: number): string[] {
  const count = new Map<string, number>();
  for (const list of lists)
    for (const v of list) if (v) count.set(v, (count.get(v) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, cap).map((e) => e[0]);
}

// 常见亲属 / 身份称谓，作为「高频词 / 禁用词不计入称谓」的兜底过滤（模型偶尔仍会漏放进来）。
// 人名无法穷举、交给提示词约束；此处只拦这类相对封闭的称呼词。
const APPELLATIONS = new Set([
  "哥哥", "姐姐", "弟弟", "妹妹", "大哥", "大姐", "二哥", "二姐", "小弟", "小妹",
  "爸爸", "妈妈", "父亲", "母亲", "爹", "娘", "爷爷", "奶奶", "外公", "外婆",
  "叔叔", "伯伯", "舅舅", "姑姑", "阿姨", "婶婶", "嫂子", "姐夫", "妹夫",
  "师父", "师傅", "师兄", "师姐", "师弟", "师妹", "徒弟", "弟子",
  "老板", "老大", "公子", "小姐", "姑娘", "大人", "陛下", "殿下", "娘子",
  "相公", "夫人", "老爷", "少爷", "先生", "太太", "丫头",
]);
// 剔除称谓词；人名由提示词兜底，此处不做启发式误伤。
function dropAppellations(words: string[]): string[] {
  return words.filter((w) => !APPELLATIONS.has(w.trim()));
}

/** Fold several per-chunk analyses into one StyleCard (deterministic). */
export function mergeStyleChunks(
  chunks: StyleAnalysis[],
  meta: { sourceFileHash: string; sourceFileName: string }
): StyleCard {
  const scores = chunks
    .map((c) => c.dialogueStyle.colloquialScore)
    .filter((n) => n > 0);
  const avgScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;
  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    sourceFileHash: meta.sourceFileHash,
    sourceFileName: meta.sourceFileName,
    createdAt: Date.now(),
    styleName:
      majority(chunks.map((c) => c.styleName)) ||
      firstNonEmpty(chunks.map((c) => c.styleName)) ||
      "未命名文风",
    signature:
      longest(chunks.map((c) => c.signature)) ||
      firstNonEmpty(chunks.map((c) => c.signature)),
    sentenceRhythm: {
      avgLength: firstNonEmpty(chunks.map((c) => c.sentenceRhythm.avgLength)),
      pattern: firstNonEmpty(chunks.map((c) => c.sentenceRhythm.pattern)),
      examples: unionCap(chunks.map((c) => c.sentenceRhythm.examples), 3),
    },
    vocabulary: {
      highFreqWords: dropAppellations(
        unionCap(chunks.map((c) => c.vocabulary.highFreqWords), 10)
      ),
      register:
        majority(chunks.map((c) => c.vocabulary.register)) ||
        firstNonEmpty(chunks.map((c) => c.vocabulary.register)),
      forbiddenWords: dropAppellations(
        unionCap(chunks.map((c) => c.vocabulary.forbiddenWords), 6)
      ),
    },
    descriptionStrategy: {
      actionVsPsychology: firstNonEmpty(
        chunks.map((c) => c.descriptionStrategy.actionVsPsychology)
      ),
      sensoryPreference: firstNonEmpty(
        chunks.map((c) => c.descriptionStrategy.sensoryPreference)
      ),
    },
    dialogueStyle: {
      colloquialScore: avgScore,
      subtextDensity:
        majority(chunks.map((c) => c.dialogueStyle.subtextDensity)) ||
        firstNonEmpty(chunks.map((c) => c.dialogueStyle.subtextDensity)),
      tagHabit: firstNonEmpty(chunks.map((c) => c.dialogueStyle.tagHabit)),
    },
    narrativeStructure: {
      perspective:
        majority(chunks.map((c) => c.narrativeStructure.perspective)) ||
        firstNonEmpty(chunks.map((c) => c.narrativeStructure.perspective)),
      timeline:
        majority(chunks.map((c) => c.narrativeStructure.timeline)) ||
        firstNonEmpty(chunks.map((c) => c.narrativeStructure.timeline)),
    },
    emotionalTone: {
      tone: firstNonEmpty(chunks.map((c) => c.emotionalTone.tone)),
      expressionMode:
        majority(chunks.map((c) => c.emotionalTone.expressionMode)) ||
        firstNonEmpty(chunks.map((c) => c.emotionalTone.expressionMode)),
    },
    rhetoric: {
      preferredTypes: unionCap(chunks.map((c) => c.rhetoric.preferredTypes), 6),
      frequency:
        majority(chunks.map((c) => c.rhetoric.frequency)) ||
        firstNonEmpty(chunks.map((c) => c.rhetoric.frequency)),
      examples: unionCap(chunks.map((c) => c.rhetoric.examples), 3),
    },
  };
}
