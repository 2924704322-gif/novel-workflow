// 对话流传输层（Sub B 客户端）。
//
// 后端 /api/agent/chat 未就绪前，Sub B 对着 lib/agent/types.ts 契约用 mock 流开发。
// 约定（见 TASKBOARD §2）：服务端以分块流逐条回传 AgentStreamEvent（每行一个 JSON）。
// 因此这里同时提供：
//   - mockChatStream：本地假流，模拟文本增量 / 工具调用 / 写操作提案 / 确认回执；
//   - httpChatStream：解析真实 NDJSON 流，联调时把 useChat 的 transport 换成它即可。

import type { AgentChatRequest, AgentStreamEvent, MdDraft } from "./types";

// 传输层统一形态：给定一次请求，异步产出一串 AgentStreamEvent。
export type ChatTransport = (
  req: AgentChatRequest,
  opts?: { signal?: AbortSignal }
) => AsyncGenerator<AgentStreamEvent, void, unknown>;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

// 把一段文本按标点/空白切成小块，模拟逐字增量的手感。
function chunkText(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const ch of text) {
    buf += ch;
    if (buf.length >= 4 || /[，。！？、；：\n]/.test(ch)) {
      out.push(buf);
      buf = "";
    }
  }
  if (buf) out.push(buf);
  return out;
}

// 触发“写操作提案”的意图关键词（仅 mock 用，真实意图判定在 runtime/工具层）。
const WRITE_INTENT = /(新建|生成|创建|续写|写|保存|扩写|改写|重写)/;

// FT-06：根据写意图生成一份符合 MdDraft 契约的 .md 提案（演示中栏 HITL 可编辑卡）。
function buildMdDraft(userText: string): MdDraft {
  const t = userText.slice(0, 24);
  if (/(章节|正文|续写|草稿|开篇|第.章)/.test(userText)) {
    return {
      fileName: "第1章_初稿.md",
      kind: "chapter",
      targetChapterId: "ch-001", // Q12：Agent 显式产出章节定位
      body: `# 第1章 初稿\n\n> 由 AI 根据「${t}」生成，确认后落稿到右栏「阅读」。\n\n夜色像浸了墨的宣纸，缓缓铺开……（正文草稿占位）\n`,
    };
  }
  if (/(人物|角色|主角|配角)/.test(userText)) {
    return {
      fileName: "人物设定_主角.md",
      kind: "setting",
      settingKind: "character",
      body: `# 人物设定\n\n> 由 AI 根据「${t}」生成。\n\n- 姓名：（待补充）\n- 身份：（待补充）\n- 动机：（待补充）\n- 弧光：（待补充）\n`,
    };
  }
  if (/(大纲|卷|脉络|分卷)/.test(userText)) {
    return {
      fileName: "大纲_卷一.md",
      kind: "setting",
      settingKind: "outline",
      body: `# 大纲 · 卷一\n\n> 由 AI 根据「${t}」生成。\n\n## 卷一主题\n（待补充）\n\n## 关键转折\n1. （待补充）\n2. （待补充）\n`,
    };
  }
  return {
    fileName: "世界观.md",
    kind: "setting",
    settingKind: "world",
    body: `# 世界观\n\n> 由 AI 根据「${t}」生成。\n\n## 地理\n（待补充）\n\n## 势力\n（待补充）\n\n## 核心法则\n（待补充）\n`,
  };
}

/**
 * 本地 mock 流：
 *  - 若带上一轮确认（confirmations）：回执每个提案是否落库，然后结束；
 *  - 否则：流式回一段助手文本；若用户话里有写意图，则演示 read 工具调用 +
 *    产出一个待确认的 ChangeProposal，等 UI 确认后由下一轮 confirmations 收尾。
 */
export async function* mockChatStream(
  req: AgentChatRequest,
  opts?: { signal?: AbortSignal }
): AsyncGenerator<AgentStreamEvent, void, unknown> {
  const { signal } = opts ?? {};

  // —— 分支一：这一轮是来处理上一轮提案的确认结果 ——
  if (req.confirmations && req.confirmations.length > 0) {
    for (const c of req.confirmations) {
      if (c.approved) {
        for (const d of chunkText(`好的，正在落库提案 ${c.proposalId}……`)) {
          yield { type: "text", delta: d };
          await sleep(45, signal);
        }
        yield {
          type: "tool_result",
          name: "save_project",
          result: { proposalId: c.proposalId, ok: true, message: "已写入本地存储" },
        };
        for (const d of chunkText("已保存。还需要我继续吗？")) {
          yield { type: "text", delta: d };
          await sleep(45, signal);
        }
      } else {
        for (const d of chunkText(`已取消提案 ${c.proposalId}，未做任何改动。`)) {
          yield { type: "text", delta: d };
          await sleep(45, signal);
        }
      }
    }
    yield { type: "done" };
    return;
  }

  // —— 分支二：普通一轮对话 ——
  const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
  const userText = lastUser?.content ?? "";
  const wantsWrite = WRITE_INTENT.test(userText);

  const opening = wantsWrite
    ? `收到，我先看看当前作品的状态${req.projectId ? `（${req.projectId}）` : ""}，再拟一份改动方案给你确认。`
    : "我在。你可以让我新建作品、生成设定集、排分卷脉络，或者续写某一章。";

  for (const d of chunkText(opening)) {
    yield { type: "text", delta: d };
    await sleep(50, signal);
  }

  if (wantsWrite) {
    yield { type: "tool_call", name: "get_project", args: { projectId: req.projectId ?? null } };
    await sleep(320, signal);
    yield {
      type: "tool_result",
      name: "get_project",
      result: { exists: Boolean(req.projectId), chapters: req.projectId ? 12 : 0 },
    };
    await sleep(160, signal);

    const proposalId = `mock-${Date.now().toString(36)}`;
    yield {
      type: "proposal",
      proposal: {
        id: proposalId,
        tool: "save_project",
        args: { projectId: req.projectId ?? null, intent: userText },
        changeSummary: `根据「${userText.slice(0, 40)}」拟写入 1 处改动（含 .md 提案），等待你确认后才落库。`,
        diff: {
          kind: "text",
          before: "（原内容）",
          after: "（拟写入的新内容——mock 占位）",
        },
        md: buildMdDraft(userText), // FT-06：附 MdDraft，驱动中栏 HitlMdCard
      },
    };
    // 提案发出后本轮先结束，等待 UI 回传 confirmations 再走确认分支。
    yield { type: "done" };
    return;
  }

  yield { type: "done" };
}

/**
 * 真实传输：解析 /api/agent/chat 的 NDJSON 分块流（每行一个 AgentStreamEvent）。
 * 联调时把 useChat 的 transport 换成 httpChatStream(apiBase) 即可。
 * apiBase 由 Sub A 落地（接缝①），Sub B 只消费；缺省用相对路径。
 */
export function httpChatStream(apiBase = ""): ChatTransport {
  return async function* (req, opts) {
    const res = await fetch(`${apiBase}/api/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: opts?.signal,
    });
    if (!res.ok || !res.body) {
      const msg = await res.text().catch(() => "请求失败");
      yield { type: "error", message: msg || `请求失败 (${res.status})` };
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          yield JSON.parse(line) as AgentStreamEvent;
        } catch {
          // 半行/坏行：跳过，等待后续分块拼齐。
        }
      }
    }
    const tail = buf.trim();
    if (tail) {
      try {
        yield JSON.parse(tail) as AgentStreamEvent;
      } catch {
        /* ignore trailing partial */
      }
    }
  };
}
