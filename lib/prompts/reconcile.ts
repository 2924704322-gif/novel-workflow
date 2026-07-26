// 一致性统一（reconcile）提示词构造。从原 lib/prompts.ts 搬来，逻辑未改。

import type { StoryBible } from "../types";
import type { ChatMessage } from "../llm";
import type { ReconcileChange, ReconcilePayload } from "../reconcile";
import { SYSTEM_RECONCILER, bibleBlock } from "./shared";

/**
 * After an upstream artifact is regenerated, review the downstream planning
 * artifacts and return only the targeted edits needed to keep the book
 * consistent, plus an author-facing summary of what changed. Never rewrites
 * prose — only flags chapters whose written prose may now conflict. Returns
 * JSON matching lib/reconcile.ReconcileResult.
 */
export function buildReconcilePrompt(
  change: ReconcileChange,
  payload: ReconcilePayload,
  bible: StoryBible | null
): ChatMessage[] {
  const originLabel =
    change.origin === "bible"
      ? "故事设定集（全书顶层设定）"
      : change.origin === "chapter-outline"
      ? "某一章的章节脉络"
      : "某一章的正文";
  const dir = (change.direction || "").trim()
    ? `\n本次调整方向（作者指定）：${change.direction!.trim()}`
    : "";
  const bibleRef = bible
    ? `\n【全书设定基准（仅供参考，勿修改）】\n${bibleBlock(bible)}\n`
    : "";
  const volLines = payload.volumes.length
    ? payload.volumes
        .map(
          (v) =>
            `- [volume id=${v.volumeId}] 第${v.index}卷「${v.title}」卷纲：${
              v.summary || "（暂无）"
            }`
        )
        .join("\n")
    : "（无）";
  const chapLines = payload.chapters.length
    ? payload.chapters
        .map(
          (c) =>
            `- [chapter id=${c.chapterId}] 第${c.global}章「${c.title}」` +
            `${c.hasContent ? "（已有正文）" : ""}\n` +
            `    脉络：${c.synopsis || "（暂无）"}\n` +
            `    摘要：${c.summary || "（暂无）"}`
        )
        .join("\n")
    : "（无）";
  return [
    { role: "system", content: SYSTEM_RECONCILER },
    {
      role: "user",
      content: `作者刚刚重新生成了${originLabel}。请据此对下游内容做一致性统一。

【本次改动】${change.label}
【改动后的权威内容（下游必须与之保持一致）】
${change.detail || "（未提供，请依据设定基准判断）"}${dir}
${bibleRef}
【受影响的卷纲】
${volLines}

【受影响的章节脉络与摘要（按顺序）】
${chapLines}

请审阅后输出如下结构的 JSON：
{
  "changeSummary": "用2-4句话面向作者说明：本次改了什么、为保持一致对下游做了哪些统一（若无需改动则说明原因）",
  "updates": [
    { "kind": "chapter-synopsis", "chapterId": "上面给出的对应 id", "value": "修订后的章节脉络" },
    { "kind": "chapter-summary", "chapterId": "对应 id", "value": "修订后的章节摘要" },
    { "kind": "chapter-title", "chapterId": "对应 id", "value": "修订后的标题" },
    { "kind": "volume-summary", "volumeId": "对应 id", "value": "修订后的卷纲" }
  ],
  "staleProse": [已有正文但因本次改动而可能前后矛盾、建议作者复核/重写的章节全局序号]
}

要求：
1. 只对确实与改动后内容矛盾、或衔接不上的条目做修订；无需改动的条目一律不要放进 updates。
2. id 必须原样照抄上面方括号中给出的 id，不得杜撰或改写；kind 必须是上述四种之一。
3. 修订要最小必要：保持原有的写作风格、篇幅与粒度，只改动受影响的部分，不要整体重写、不要扩写。
4. 绝对不要改写或输出任何章节正文；已有正文若与新内容冲突，只把其全局序号放入 staleProse，交由作者定夺。
5. 只输出 JSON。`,
    },
  ];
}
