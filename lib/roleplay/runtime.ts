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
import { tavernStore } from "../tavern/store";
import { loadCharacter } from "./characterCard";
import type {
  CharacterCardV2,
  Lorebook,
  LorebookEntry,
  RoleplayGroup,
} from "../tavern/types";
import type {
  RoleplayCharacterCard,
  RoleplayMessage,
  RoleplayRequest,
  RoleplaySession,
  RoleplayStreamEvent,
} from "./types";
import { assemblePersona, assembleRoleContext } from "./persona";
import { scanLorebook, type ScannedEntry } from "./lorebook";

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
        turnMode: "manual" as const,
        turnOrder: [character.codexId],
        nextSpeakerIndex: 0,
        messages: [...req.messages, replyMsg],
        createdAt: now,
        updatedAt: now,
      };

  await saveRoleplaySession(session);

  yield { type: "done", sessionId: session.id };
}

// ---- 多角色轮转对话 ----

/**
 * 运行一轮多角色对话。根据 turnMode 决定发言角色，流式产出事件。
 * 向后兼容：participants.length===1 时行为与 runRoleplayTurn 一致。
 */
export async function* runMultiRoleplayTurn(
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

  // 2. 确定参与者列表
  const participants = req.participants || [];
  if (participants.length === 0) {
    yield { type: "error", message: "多角色模式需要至少一个参与者" };
    return;
  }

  // 3. 决定本轮发言角色
  const turnMode = req.turnMode || "round-robin";
  let speakerId: string;

  if (turnMode === "manual" && req.targetCharacterId) {
    speakerId = req.targetCharacterId;
  } else {
    // round-robin / narrator-driven 默认取当前顺序
    const sessionId = req.sessionId || `rp-${req.projectId}-multi`;
    const existing = await getRoleplaySession(sessionId);
    const idx = existing?.nextSpeakerIndex ?? 0;
    const order = existing?.turnOrder ?? participants.map((p) => p.codexId);
    speakerId = order[idx % order.length];
  }

  // 4. 定位发言角色
  const speaker = participants.find((p) => p.codexId === speakerId);
  if (!speaker) {
    yield { type: "error", message: `找不到发言角色 ${speakerId}` };
    return;
  }

  // 5. assemblePersona（含其他在场角色）
  const otherParticipants = participants.filter((p) => p.codexId !== speakerId);
  const { systemPrompt } = assemblePersona(project, speaker, req.messages, otherParticipants);

  // 6. 构造 LLM 消息并流式调用
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

  // 7. 落库（更新 nextSpeakerIndex）
  const now = Date.now();
  const replyMsg: RoleplayMessage = {
    id: generateId(),
    role: "character",
    characterId: speaker.codexId,
    content: replyText,
    createdAt: now,
  };

  const sessionId = req.sessionId || `rp-${req.projectId}-multi`;
  const existing = await getRoleplaySession(sessionId);

  const turnOrder = existing?.turnOrder ?? participants.map((p) => p.codexId);
  const currentIdx = existing?.nextSpeakerIndex ?? 0;
  const nextIdx = (currentIdx + 1) % turnOrder.length;

  const session: RoleplaySession = existing
    ? {
        ...existing,
        participants,
        activeCharacterId: speaker.codexId,
        turnMode,
        turnOrder,
        nextSpeakerIndex: nextIdx,
        messages: [...req.messages, replyMsg],
        updatedAt: now,
      }
    : {
        id: sessionId,
        ownerId: ctx.ownerId,
        projectId: req.projectId,
        participants,
        activeCharacterId: speaker.codexId,
        turnMode,
        turnOrder,
        nextSpeakerIndex: nextIdx,
        messages: [...req.messages, replyMsg],
        createdAt: now,
        updatedAt: now,
      };

  await saveRoleplaySession(session);

  const nextSpeakerName = participants.find(
    (p) => p.codexId === turnOrder[nextIdx]
  )?.name;

  yield { type: "done", sessionId: session.id, nextSpeaker: nextSpeakerName };
}

// ---- 群组轮转（FT-18）-------------------------------------------------------
//
// 扩展现有运行时以支持 SillyTavern 群组范式：
//   - activationStrategy（选下一位发言者）：list（round-robin）/ manual（指定）/
//     natural / pooled（本批仅留接口，未实现，规划 FT-P1/Q9）。
//   - generationMode（注入方式）：swap（仅注入当前发言者卡）/ append（合并所有成员卡）。
//   - 群组成员卡经 FT-16 loadCharacter 加载（回退 codex，保证对话可跑）。
//
// 注：lorebook 注入与 scenarioOverride 应用由 FT-19 assembleRoleContext 接管；
// runGroupTurn 内联收集世界书（项目级 + 角色私有 + 显式指定）并经 scanLorebook 扫描，
// 再调用 assembleRoleContext 合并卡 + 群组卡（swap/append）。

type ActivationStrategy = RoleplayGroup["activationStrategy"];

interface SpeakerResolution {
  speakerId: string;
  nextIdx: number; // 下一轮 round-robin 指针（list 模式有效）
}

/**
 * 依据群组激活策略解析本轮发言者。
 *
 * - list：按 members 顺序轮转（跳过 disabledMembers）；allowSelfResponses=false 时
 *   避免连续自回（跳过与上轮 activeCharacterId 相同的发言者）。
 * - manual：若给定 manualTarget 且为可用成员则用它；否则回退 list 行为（保证可跑）。
 * - natural / pooled：本批未实现，返回 null（调用方产出清晰错误事件，留接口）。
 */
function resolveGroupSpeaker(
  group: RoleplayGroup,
  enabledMemberIds: string[],
  session: RoleplaySession | null,
  strategy: ActivationStrategy,
  manualTarget?: string
): SpeakerResolution | null {
  if (enabledMemberIds.length === 0) return null;

  if (strategy === "list") {
    const idx = session?.nextSpeakerIndex ?? 0;
    let chosen = idx % enabledMemberIds.length;
    if (
      !group.allowSelfResponses &&
      session?.activeCharacterId === enabledMemberIds[chosen]
    ) {
      chosen = (chosen + 1) % enabledMemberIds.length;
    }
    return {
      speakerId: enabledMemberIds[chosen],
      nextIdx: (chosen + 1) % enabledMemberIds.length,
    };
  }

  if (strategy === "manual") {
    if (manualTarget && enabledMemberIds.includes(manualTarget)) {
      // manual 不改轮转指针
      return { speakerId: manualTarget, nextIdx: session?.nextSpeakerIndex ?? 0 };
    }
    // 未指定 target → 回退 list，保持对话可跑
    const idx = session?.nextSpeakerIndex ?? 0;
    return {
      speakerId: enabledMemberIds[idx % enabledMemberIds.length],
      nextIdx: (idx + 1) % enabledMemberIds.length,
    };
  }

  // natural / pooled：本批仅留接口（FT-P1/Q9）
  return null;
}

/**
 * 运行一轮群组对话，流式产出事件。
 *
 * 行为：
 *   1. 加载作品 + 群组（tavernStore.listGroups 按 ownerId/projectId 过滤）。
 *   2. 按 activationStrategy 选发言者（list/manual；natural/pooled 留接口）。
 *   3. 经 FT-16 loadCharacter 加载成员卡（回退 codex）。
 *   4. 按 generationMode 决定注入单卡（swap）或合并卡（append）。
 *   5. 流式生成，落库 RoleplaySession（维护 nextSpeakerIndex 供 list 轮转）。
 */
export async function* runGroupTurn(
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
  if (!req.groupId) {
    yield { type: "error", message: "runGroupTurn 需要 groupId" };
    return;
  }

  // 2. 加载群组
  const groups = await tavernStore.listGroups(ctx.ownerId, req.projectId);
  const group = groups.find((g) => g.id === req.groupId);
  if (!group) {
    yield { type: "error", message: `找不到群组 ${req.groupId}` };
    return;
  }

  const enabledMemberIds = group.members.filter(
    (id) => !group.disabledMembers.includes(id)
  );
  if (enabledMemberIds.length === 0) {
    yield { type: "error", message: "群组没有可用成员（全部被静音）" };
    return;
  }

  // 3. 选发言者
  const sessionId = req.sessionId || `rp-${req.projectId}-group-${group.id}`;
  const existing = await getRoleplaySession(sessionId);
  const strategy = req.activationStrategy ?? group.activationStrategy;
  const resolution = resolveGroupSpeaker(
    group,
    enabledMemberIds,
    existing,
    strategy,
    req.targetCharacterId
  );
  if (!resolution) {
    yield {
      type: "error",
      message: `activationStrategy「${strategy}」尚未实现（规划于 FT-P1/Q9）`,
    };
    return;
  }
  const speakerId = resolution.speakerId;

  // 4. 经 FT-16 loadCharacter 加载成员卡（回退 codex，保证对话可跑）。
  //    同时保留 CharacterCardV2（供 FT-19 assembleRoleContext 注入 lorebook / 合并群组卡）。
  const memberCards: RoleplayCharacterCard[] = [];
  const memberCardsV2: CharacterCardV2[] = [];
  for (const id of enabledMemberIds) {
    const cardV2 = await loadCharacter(id, project);
    memberCardsV2.push(cardV2);
    const codex = project.codex.find((e) => e.id === id);
    memberCards.push({
      codexId: id,
      name: cardV2.data.name || codex?.name || id,
      aliases: codex?.aliases || [],
      summary: cardV2.data.description || codex?.summary || "",
      status: cardV2.extensions?.novelchat?.status || codex?.status,
      pinned: cardV2.extensions?.novelchat?.pinned || codex?.pinned,
    });
  }

  const speaker = memberCards.find((m) => m.codexId === speakerId);
  if (!speaker) {
    yield { type: "error", message: `找不到发言角色 ${speakerId}` };
    return;
  }
  const speakerV2 = memberCardsV2.find(
    (m) => m.extensions?.novelchat?.codexId === speakerId
  );
  if (!speakerV2) {
    yield { type: "error", message: `找不到发言角色卡 ${speakerId}` };
    return;
  }

  // 5. generationMode：swap=仅发言者；append=合并所有成员为共享上下文
  const generationMode = req.generationMode ?? group.generationMode;

  // —— FT-19：世界书加载 + 扫描 + assembleRoleContext 接管 lorebook 注入 ——
  // 收集世界书条目（Q10：仅 (a) 项目级 + (b) 发言者角色私有 + (c) 显式指定，无全局层）。
  const projectBooks = await tavernStore.listLorebooks(ctx.ownerId, req.projectId);
  const allEntries: LorebookEntry[] = [];
  for (const b of projectBooks) {
    if (b.entries?.length) allEntries.push(...b.entries);
  }
  // (b) 发言者角色私有书（data.character_book）
  const privateBook = speakerV2.data.character_book;
  if (privateBook?.entries?.length) allEntries.push(...privateBook.entries);
  // (c) 显式指定
  for (const lid of req.lorebookIds ?? []) {
    const book = await tavernStore.readLorebook(lid);
    if (book?.entries?.length) allEntries.push(...book.entries);
  }

  // 扫描参数：请求级 > 主书（首个项目书或发言者私有书）> 默认
  const primaryBook: Lorebook | undefined = projectBooks[0] ?? privateBook;
  const scanDepth = req.scanDepth ?? primaryBook?.scan_depth ?? 20;
  const tokenBudget = req.tokenBudget ?? primaryBook?.token_budget ?? 1024;
  const recursive = primaryBook?.recursive_scanning ?? false;

  const recentMessages = req.messages.slice(-scanDepth).map((m) => m.content);
  const scannedLore: ScannedEntry[] = scanLorebook(allEntries, recentMessages, {
    scanDepth,
    tokenBudget,
    recursiveScanning: recursive,
  });

  // 请求级 scenarioOverride 覆盖群组情境
  const effectiveGroup =
    req.scenarioOverride && group
      ? { ...group, scenarioOverride: req.scenarioOverride }
      : group;

  const { systemPrompt } = assembleRoleContext(speakerV2, scannedLore, {
    group: effectiveGroup,
    generationMode,
    memberCards: memberCardsV2,
    tone: project.bible?.tone,
  });

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

  // 6. 落库（维护 nextSpeakerIndex 供 list 轮转）
  const now = Date.now();
  const replyMsg: RoleplayMessage = {
    id: generateId(),
    role: "character",
    characterId: speaker.codexId,
    content: replyText,
    createdAt: now,
  };

  const session: RoleplaySession = existing
    ? {
        ...existing,
        participants: memberCards,
        activeCharacterId: speaker.codexId,
        turnMode: strategy === "list" ? "round-robin" : "manual",
        messages: [...req.messages, replyMsg],
        nextSpeakerIndex: resolution.nextIdx,
        updatedAt: now,
      }
    : {
        id: sessionId,
        ownerId: ctx.ownerId,
        projectId: req.projectId,
        participants: memberCards,
        activeCharacterId: speaker.codexId,
        turnMode: strategy === "list" ? "round-robin" : "manual",
        turnOrder: enabledMemberIds,
        nextSpeakerIndex: resolution.nextIdx,
        messages: [...req.messages, replyMsg],
        createdAt: now,
        updatedAt: now,
      };

  await saveRoleplaySession(session);

  const nextSpeakerName = memberCards.find(
    (m) =>
      m.codexId ===
      enabledMemberIds[resolution.nextIdx % enabledMemberIds.length]
  )?.name;

  yield { type: "done", sessionId: session.id, nextSpeaker: nextSpeakerName };
}

// ---- 世界书收集 / 扫描（FT-19） ---------------------------------------------
//
// 群组世界书收集与扫描已内联于 runGroupTurn（见上方「FT-19：世界书加载…」段）：
// 仅 (a) 项目级 listLorebooks(ownerId, projectId) + (b) 发言者角色私有
// data.character_book + (c) 显式 req.lorebookIds（经 readLorebook）→ scanLorebook。
// Q10：无全局 lorebook 层（不扫描 owner 名下与当前 project/发言者无关的书）。

