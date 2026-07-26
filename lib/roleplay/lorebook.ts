// 酒馆AI · 世界书 lorebook 扫描 / 注入引擎（FT-17）
//
// 纯函数引擎，对齐 SillyTavern CharacterBook V2（World Info）：
//   - 关键词匹配：每条 entry 的 keys / secondary_keys，支持字面匹配 + `/regex/` 正则，
//     case_sensitive 控制大小写。
//   - constant 条目强制注入（无视关键词）；enabled=false 跳过；
//     selective 需任一主 key 命中，且全部 secondary_keys 同时命中。
//   - 排序：insertion_order 升序。
//   - recursive_scanning：命中条目的 content 可递归触发其它条目（最多 2 层，防环）。
//   - token 预算：按 tokenBudget（默认 1024）裁剪，中文≈1.6 字/token 启发式
//     （MVP 零依赖；精确预算按需接 gpt-tokenizer）。priority 高者优先保留，
//     constant 永不被裁。
//   - 扫描窗口：最近 scanDepth（默认 20）条消息。
//
// 设计原则：纯函数、无副作用、可单测（见 lorebook.test.ts）。
//
// GitHub 取经（SillyTavern World Info / CharacterBook V2）：
//   - 匹配：keys 默认大小写不敏感；以 `/` 包裹视为 JS 正则（regex key）。
//   - 预算超限：按 priority 升序丢弃（值越小越先被丢弃）；constant 始终保留。
//   - 插入顺序：insertion_order 数值越小越先插入（对输出影响越大）。

import type { LorebookEntry } from "../tavern/types";

/** 扫描选项（对齐 Lorebook 容器默认值）。 */
export interface ScanOptions {
  /** 取最近 N 条消息作 haystack，默认 20 */
  scanDepth?: number;
  /** 近似 token 上限，默认 1024 */
  tokenBudget?: number;
  /** 命中正文能否再触发其它 entry，默认 false */
  recursiveScanning?: boolean;
}

/** 扫描命中结果：含 content、排序位置与命中理由，供 persona 拼注入文本。 */
export interface ScannedEntry {
  entry: LorebookEntry;
  /** 命中的关键词（constant 时为 undefined） */
  matchedKey?: string;
  /** 人类可读的命中理由（调试 / UI 展示） */
  reason: string;
  /** content 的近似 token 估算 */
  tokens: number;
}

// ---- token 估算（启发式，零依赖） -------------------------------------------

const CJK_RE =
  /[⺀-䶿一-鿿豈-﫿＀-￯]/g;

/**
 * 估算文本的近似 token 数。
 * 中文（CJK）≈ 1.6 字/token；其它（英文/标点）≈ 4 字/token。
 * 零依赖字符启发式；若需精确预算，可在上层替换为 gpt-tokenizer。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(CJK_RE) || []).length;
  const other = text.length - cjk;
  return Math.max(1, Math.ceil(cjk / 1.6 + other / 4));
}

// ---- 关键词匹配 -------------------------------------------------------------

/**
 * 判断单条 key 是否命中 haystack。
 *
 * 规则（SillyTavern 范式）：
 *   - key 以 `/` 包裹（且内部含至少一个 `/`）→ 视为 JS 正则。
 *     例：`/魔法|法术/` 或 `/colou?r/i`。case_sensitive=false 时默认追加 `i` 标志。
 *   - 否则为字面匹配；case_sensitive=false 时大小写不敏感。
 *   - 空 key 永不命中。
 *
 * @param caseSensitive 覆盖正则/字面的默认大小写行为。
 */
export function matchKey(
  haystack: string,
  key: string,
  caseSensitive: boolean
): boolean {
  if (!key) return false;

  // 正则 key：/pattern/ 或 /pattern/flags
  if (key.length >= 2 && key.startsWith("/") && key.lastIndexOf("/") > 0) {
    const lastSlash = key.lastIndexOf("/");
    const pattern = key.slice(1, lastSlash);
    let flags = key.slice(lastSlash + 1);
    // SillyTavern：默认大小写不敏感（追加 i）；case_sensitive 时移除 i。
    if (!caseSensitive && !flags.includes("i")) flags += "i";
    if (caseSensitive) flags = flags.replace("i", "");
    try {
      return new RegExp(pattern, flags).test(haystack);
    } catch {
      // 非法正则 → 视为无命中（不抛错，保证运行时稳健）
      return false;
    }
  }

  if (caseSensitive) return haystack.includes(key);
  return haystack.toLowerCase().includes(key.toLowerCase());
}

// ---- 单条 entry 评估 --------------------------------------------------------

interface EntryEval {
  hit: boolean;
  key?: string;
}

/**
 * 在给定 haystack 上评估一条 entry 是否应注入（不含预算 / 排序）。
 */
function evalEntry(entry: LorebookEntry, haystack: string): EntryEval {
  if (!entry.enabled) return { hit: false };
  if (entry.constant) return { hit: true }; // constant 恒定注入

  const cs = entry.case_sensitive ?? false;
  const keys = (entry.keys || []).filter((k) => !!k);
  const secondary = (entry.secondary_keys || []).filter((k) => !!k);
  if (keys.length === 0) return { hit: false }; // 无 key 普通条目无法触发

  const primaryKey = keys.find((k) => matchKey(haystack, k, cs));

  if (entry.selective) {
    // selective：任一主 key 命中 且 全部 secondary_keys 命中
    const secondaryAll =
      secondary.length === 0
        ? true
        : secondary.every((k) => matchKey(haystack, k, cs));
    return { hit: !!primaryKey && secondaryAll, key: primaryKey };
  }

  return { hit: !!primaryKey, key: primaryKey };
}

// ---- 扫描主流程 -------------------------------------------------------------

/**
 * 扫描世界书条目，返回已排序、预算内、待注入的条目集合。
 *
 * @param entries        全部 lorebook entry（未过滤）
 * @param recentMessages 最近若干条对话文本（顺序不限；内部取末 scanDepth 条）
 * @param opts           扫描选项（scanDepth / tokenBudget / recursiveScanning）
 * @returns ScannedEntry[]，按 insertion_order 升序排列（注入顺序）
 */
export function scanLorebook(
  entries: LorebookEntry[],
  recentMessages: string[],
  opts: ScanOptions = {}
): ScannedEntry[] {
  const scanDepth = opts.scanDepth ?? 20;
  const tokenBudget = opts.tokenBudget ?? 1024;
  const recursive = opts.recursiveScanning ?? false;

  const haystackBase = recentMessages.slice(-scanDepth).join("\n");

  const matched = new Map<string, ScannedEntry>();
  const matchedIds = new Set<string>();

  // 1) 首轮：基于对话窗口匹配
  for (const entry of entries) {
    const { hit, key } = evalEntry(entry, haystackBase);
    if (!hit) continue;
    matchedIds.add(entry.id);
    matched.set(entry.id, {
      entry,
      matchedKey: key,
      reason: entry.constant ? "constant（恒定注入）" : `关键词「${key}」命中`,
      tokens: estimateTokens(entry.content),
    });
  }

  // 2) 递归扫描：命中条目的 content 追加进 haystack，再触发其它条目（最多 2 层）
  if (recursive) {
    let layer = 0;
    let haystack =
      haystackBase +
      "\n" +
      [...matched.values()].map((m) => m.entry.content).join("\n");
    while (layer < 2) {
      layer++;
      let added = false;
      for (const entry of entries) {
        if (matchedIds.has(entry.id)) continue;
        const { hit, key } = evalEntry(entry, haystack);
        if (!hit) continue;
        matchedIds.add(entry.id);
        matched.set(entry.id, {
          entry,
          matchedKey: key,
          reason: `递归命中关键词「${key}」`,
          tokens: estimateTokens(entry.content),
        });
        added = true;
      }
      if (!added) break;
      haystack += "\n" + [...matched.values()].map((m) => m.entry.content).join("\n");
    }
  }

  // 3) 预算裁剪：constant 永不被裁；其余按 priority 降序保留（高优先级先留），
  //    超出 tokenBudget 时丢弃低优先级条目。
  const all = [...matched.values()];
  const constants = all.filter((m) => m.entry.constant);
  const others = all.filter((m) => !m.entry.constant);

  others.sort((a, b) => {
    const pa = a.entry.priority ?? 10;
    const pb = b.entry.priority ?? 10;
    if (pa !== pb) return pb - pa; // 高优先级先保留
    return a.entry.insertion_order - b.entry.insertion_order;
  });

  let used = constants.reduce((sum, m) => sum + m.tokens, 0);
  const kept: ScannedEntry[] = [...constants];
  for (const m of others) {
    if (used + m.tokens <= tokenBudget) {
      kept.push(m);
      used += m.tokens;
    }
    // 超出预算 → 丢弃（低优先级）
  }

  // 4) 最终注入顺序：insertion_order 升序
  kept.sort((a, b) => a.entry.insertion_order - b.entry.insertion_order);
  return kept;
}
