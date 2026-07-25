// 酒馆式角色卡对话 —— 运行时。
//
// 纯流式文本生成（无工具循环）：
//   1. 加载作品 + 角色 → assemblePersona 生成 system prompt
//   2. 将多轮 RoleplayMessage 转换为 LLM messages 格式
//   3. 调用 streamChat 流式生成角色回复
//   4. 逐块 yield RoleplayStreamEvent
//   5. 轮次结束后落库 RoleplaySession

import { promises as fs } from "fs";
import path from "path";
import type { ApiConfig, Project } from "../types";
import { projectRepository } from "../repository";
import { streamChat, type ChatMessage as LLMMessage } from "../llm";
import { dataRoot } from "../storage";
import { assemblePersona } from "./persona";
import type {
  RoleplayCharacterCard,
  RoleplayMessage,
  RoleplayRequest,
  RoleplaySession,
  RoleplayStreamEvent,
} from "./types";

// ---- Session 持久化 ----

const ROLEPLAY_DIR = path.join(dataRoot(), "roleplay");

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

export async function getRoleplaySession(id: string): Promise<RoleplaySession | null> {
  try {
    const raw = await fs.readFile(path.join(ROLEPLAY_DIR, `${safeId(id)}.json`), "utf-8");
    return JSON.parse(raw) as RoleplaySession;
  } catch {
    return null;
  }
}

export async function saveRoleplaySession(session: RoleplaySession): Promise<RoleplaySession> {
  await fs.mkdir(ROLEPLAY_DIR, { recursive: true });
  session.updatedAt = Date.now();
  await fs.writeFile(
    path.join(ROLEPLAY_DIR, `${safeId(session.id)}.json`),
    JSON.stringify(session, null, 2),
    "utf-8"
  );
  return session;
}

export async function listRoleplaySessions(ownerId: string, projectId?: string): Promise<RoleplaySession[]> {
  await fs.mkdir(ROLEPLAY_DIR, { recursive: true });
  const files = await fs.readdir(ROLEPLAY_DIR);
  const out: RoleplaySession[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const s = JSON.parse(await fs.readFile(path.join(ROLEPLAY_DIR, f), "utf-8")) as RoleplaySession;
      if (s.ownerId === ownerId && (!projectId || s.projectId === projectId)) {
        out.push(s);
      }
    } catch { /* skip */ }
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

// ---- 消息转换 ----

/** 将 RoleplayMessage[] 转为 LLM 对话格式。 */
function toLLMMessages(systemPrompt: string, messages: RoleplayMessage[]): LLMMessage[] {
  const out: LLMMessage[] = [{ role: "system", content: systemPrompt }];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "character") {
      out.push({ role: "assistant", content: m.content });
    } else if (m.role === "system") {
      // 系统旁白作为 system 消息插入（场景设定等）
      out.push({ role: "system", content: m.content });
    }
  }
  return out;
}

// ---- 核心运行时 ----

function generateId(): string {
  return `rp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 运行一轮角色对话，流式产出事件。
 * 调用方（route handler）迭代此 generator 并逐块回传客户端。
 */
export async function* runRoleplayTurn(
  req: RoleplayRequest,
  ctx: { ownerId: string },
  signal?: AbortSignal
): AsyncGenerator<RoleplayStreamEvent, void, unknown> {
  // 1. 加载作品
  const project = await projectRepository.get(ctx.ownerId, req.projectId);
  if (!project) {
    yield { type: "error", message: `找不到作品 ${req.projectId}` };
    return;
  }

  // 2. 定位角色
  const charEntry = project.codex.find(
    (e) => e.id === req.characterId && e.category === "人物"
  );
  if (!charEntry) {
    yield { type: "error", message: `找不到角色 ${req.characterId}（需为"人物"类型的设定条目）` };
    return;
  }

  const character: RoleplayCharacterCard = {
    codexId: charEntry.id,
    name: charEntry.name,
    aliases: charEntry.aliases || [],
    summary: charEntry.summary,
    status: charEntry.status,
    pinned: charEntry.pinned,
  };

  // 3. assemblePersona
  const { systemPrompt } = assemblePersona(project, character, req.messages);

  // 4. 构造 LLM 消息并流式调用
  const llmMessages = toLLMMessages(systemPrompt, req.messages);

  let replyText = "";
  try {
    const stream = await streamChat(req.config, llmMessages, { signal });
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        replyText += chunk;
        yield { type: "text", delta: chunk };
      }
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    yield { type: "error", message: (err as Error).message || "生成失败" };
    return;
  }

  // 5. 落库
  const now = Date.now();
  const replyMsg: RoleplayMessage = {
    id: generateId(),
    role: "character",
    characterId: character.codexId,
    content: replyText,
    createdAt: now,
  };

  const sessionId = req.sessionId || `rp-${req.projectId}-${req.characterId}`;
  const existing = await getRoleplaySession(sessionId);

  const session: RoleplaySession = existing
    ? {
        ...existing,
        messages: [...req.messages, replyMsg],
        updatedAt: now,
      }
    : {
        id: sessionId,
        ownerId: ctx.ownerId,
        projectId: req.projectId,
        participants: [character],
        activeCharacterId: character.codexId,
        messages: [...req.messages, replyMsg],
        createdAt: now,
        updatedAt: now,
      };

  await saveRoleplaySession(session);

  yield { type: "done", sessionId: session.id };
}
