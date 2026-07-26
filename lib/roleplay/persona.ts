// 酒馆式角色卡对话 —— 人设组装层（FT-19 重构）。
//
// 本文件提供两套组装能力，向后兼容并存：
//   1. assemblePersona（旧路径，1v1 / 多角色）：基于 CodexEntry 派生的
//      RoleplayCharacterCard 组装 system prompt，沿用 codex / bible.tone 检索。
//   2. assembleRoleContext（新路径，群组 / 酒馆AI）：基于 Character Card V2
//      （FT-16 loadCharacter）+ 世界书扫描结果（FT-17 scanLorebook）+ 群组卡
//      （FT-18）合并生成 system prompt，对齐 SillyTavern 范式。
//
// FT-19 关键变更：runGroupTurn 中的临时 assemblePersona 调用已平滑替换为
// assembleRoleContext（见 runtime.ts 中「FT-19：世界书加载…」接管实现）。

import type { CodexEntry, Project } from "../types";
import { selectRelevantCodex } from "../retrieval";
import { cardToPersonaBlock } from "./characterCard";
import type { ScannedEntry } from "./lorebook";
import type { CharacterCardV2, RoleplayGroup } from "../tavern/types";
import type { RoleplayCharacterCard, RoleplayMessage } from "./types";

// ---- 旧路径：assemblePersona（1v1 / 多角色，向后兼容） --------------------

export interface PersonaContext {
  systemPrompt: string;
  // 注入的世界书条目（便于调试 / 未来 UI 展示）
  worldEntries: CodexEntry[];
}

/**
 * 为一次角色对话轮次组装完整的 system prompt。
 *
 * @param project     当前作品（获取 codex、bible.tone）
 * @param character   对话角色卡
 * @param messages    对话历史（用于检索世界书相关条目）
 * @param otherParticipants  多角色模式下的其他在场角色（可选）
 */
export function assemblePersona(
  project: Project,
  character: RoleplayCharacterCard,
  messages: RoleplayMessage[],
  otherParticipants?: RoleplayCharacterCard[]
): PersonaContext {
  // ---- 1. 角色人设段 ----
  const charEntry = project.codex.find((e) => e.id === character.codexId);
  const aliasStr = character.aliases.length
    ? `（别名：${character.aliases.join("、")}）`
    : "";
  const statusStr = character.status ? `\n当前状态：${character.status}` : "";

  // 取最近 5 条 events 作为角色近况
  const events = charEntry?.events?.slice(-5) ?? [];
  const eventsStr = events.length
    ? `\n近期经历：\n${events.map((e) => `- 第${e.chapter}章：${e.note}`).join("\n")}`
    : "";

  const personaBlock = [
    `## 你的身份`,
    `你是「${character.name}」${aliasStr}。`,
    character.summary,
    statusStr,
    eventsStr,
  ]
    .filter(Boolean)
    .join("\n");

  // ---- 2. 世界书（selectRelevantCodex） ----
  // 用最近几轮对话作为检索文本
  const recentText = messages
    .slice(-6)
    .map((m) => m.content)
    .join("\n");
  const coreNames = (project.bible?.characters || [])
    .map((c) => c.name)
    .filter(Boolean);
  // 排除当前角色自身，避免重复
  const codexPool = project.codex.filter((e) => e.id !== character.codexId);
  const worldEntries = selectRelevantCodex(codexPool, recentText, 0, coreNames, 10);

  const worldBlock = worldEntries.length
    ? [
        `## 世界书（相关设定）`,
        ...worldEntries.map(
          (e) => `- 【${e.category}】${e.name}：${e.summary}`
        ),
      ].join("\n")
    : "";

  // ---- 3. bible.tone（文风与叙事视角） ----
  const tone = project.bible?.tone?.trim() || "";
  const toneBlock = tone ? `## 叙事文风\n${tone}` : "";

  // ---- 4. 其他在场角色（多角色模式） ----
  const othersBlock =
    otherParticipants && otherParticipants.length > 0
      ? [
          `## 在场的其他角色`,
          ...otherParticipants.map(
            (p) => `- ${p.name}${p.status ? `（${p.status}）` : ""}：${p.summary.slice(0, 60)}`
          ),
        ].join("\n")
      : "";

  // ---- 组装 system prompt ----
  const systemPrompt = [
    `你正在进行一场沉浸式角色扮演对话。你扮演作品「${project.title}」中的角色。`,
    `请始终以角色的第一人称视角回复，保持角色性格和说话方式的一致性。`,
    `不要出戏、不要解释你是AI、不要使用 OOC（Out Of Character）。`,
    `回复长度适中（50~300字），保持对话节奏感。可以包含动作描写（用*斜体*标注）。`,
    "",
    personaBlock,
    "",
    othersBlock,
    "",
    toneBlock,
    "",
    worldBlock,
  ]
    .filter((s) => s !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { systemPrompt, worldEntries };
}

// ---- 新路径：assembleRoleContext（群组 / 酒馆AI，FT-19） -------------------
//
// 以 CharacterCardV2 为中心，拼装 SillyTavern 对齐的 role context：
//   Header → persona 段 → 群组情境 → 在场其他角色(append) → 叙事文风 → 世界书注入。
// 世界书（lorebook）注入顺序在 persona 之后，保证角色身份为主（character identity primary）。
// 纯函数、无副作用，便于单测（见 persona.test.ts）。

/** assembleRoleContext 选项。 */
export interface RoleContextOptions {
  /** 群组（用于 scenarioOverride 注入） */
  group?: RoleplayGroup;
  /** swap=仅发言者；append=合并所有成员卡 */
  generationMode?: "swap" | "append";
  /** 群组全部成员卡（append 模式拼「在场的其他角色」） */
  memberCards?: CharacterCardV2[];
  /** 叙事文风（来自 project.bible?.tone） */
  tone?: string;
}

/** 组装产物：系统提示 + 实际注入的世界书条目。 */
export interface RoleContext {
  systemPrompt: string;
  /** 实际注入的世界书条目（调试 / 未来 UI 展示） */
  worldEntries: ScannedEntry[];
}

/**
 * 以角色卡为中心，组装一轮群组/角色对话的 system prompt。
 *
 * 拼装顺序（对齐 SillyTavern 社区实践）：
 *   1. Header（第一人称 / 不出戏 / 50~300字 指引）
 *   2. persona 段（cardToPersonaBlock：身份/性格/情境/开场白/示例/系统提示）
 *   3. 群组情境（仅当 opts.group.scenarioOverride 存在）
 *   4. 在场的其他角色（仅 append 模式，且 m !== card；每位截断 ~120 字）
 *   5. 叙事文风（仅当 opts.tone 存在）
 *   6. 世界书（自动注入，仅当 scannedLore 非空；置于 persona 之后）
 *
 * @param card        发言者角色卡（CharacterCardV2）
 * @param scannedLore 已扫描、排序、预算内的世界书条目
 * @param opts        选项（群组 / 生成模式 / 成员卡 / 文风）
 */
export function assembleRoleContext(
  card: CharacterCardV2,
  scannedLore: ScannedEntry[],
  opts?: RoleContextOptions
): RoleContext {
  // 1. Header（与 assemblePersona 同口径）
  const header = [
    `你正在进行一场沉浸式角色扮演对话。你扮演由下方「人设」定义的角色。`,
    `请始终以角色的第一人称视角回复，保持角色性格和说话方式的一致性。`,
    `不要出戏、不要解释你是AI、不要使用 OOC（Out Of Character）。`,
    `回复长度适中（50~300字），保持对话节奏感。可以包含动作描写（用*斜体*标注）。`,
  ].join("\n");

  const parts: string[] = [header];

  // 2. persona 段（角色身份优先）
  const personaBlock = cardToPersonaBlock(card);
  if (personaBlock) parts.push(personaBlock);

  // 3. 群组情境（scenarioOverride）
  if (opts?.group?.scenarioOverride) {
    parts.push(`## 群组情境\n${opts.group.scenarioOverride}`);
  }

  // 4. 在场的其他角色（仅 append 模式）
  if (opts?.generationMode === "append" && opts.memberCards && opts.memberCards.length) {
    // P2-6：优先按 codexId 排除发言者自身（引用相等仅在无 codexId 时兜底，
    // 避免调用方传入反序列化副本时把自己也列进「其他角色」）。
    const selfId = card.extensions?.novelchat?.codexId;
    const others = opts.memberCards
      .filter((m) => {
        const mid = m.extensions?.novelchat?.codexId;
        return selfId && mid ? mid !== selfId : m !== card;
      })
      .map((m) => {
        const block = cardToPersonaBlock(m);
        const truncated = block.length > 120 ? `${block.slice(0, 120)}…` : block;
        return `## 在场的其他角色\n${truncated}`;
      });
    if (others.length) parts.push(others.join("\n\n"));
  }

  // 5. 叙事文风
  if (opts?.tone) {
    parts.push(`## 叙事文风\n${opts.tone}`);
  }

  // 6. 世界书（自动注入，置于 persona 之后）
  if (scannedLore.length) {
    const lines = [
      `## 世界书（自动注入）`,
      ...scannedLore.map(
        (e) => `- （命中「${e.matchedKey ?? "constant"}」）${e.entry.content}`
      ),
    ];
    parts.push(lines.join("\n"));
  }

  const systemPrompt = parts
    .filter((s) => s.trim().length > 0)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { systemPrompt, worldEntries: scannedLore };
}

// ---- getAvailableCharacters（保留，向后兼容） -----------------------------

/**
 * 从项目 codex 中提取可用于对话的角色列表（category="人物"且有 summary）。
 */
export function getAvailableCharacters(project: Project): RoleplayCharacterCard[] {
  return project.codex
    .filter((e) => e.category === "人物" && e.summary)
    .map((e) => ({
      codexId: e.id,
      name: e.name,
      aliases: e.aliases || [],
      summary: e.summary,
      status: e.status,
      pinned: e.pinned,
    }));
}
