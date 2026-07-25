// 酒馆式角色卡对话 —— 人设组装层。
//
// per-turn assemblePersona：
//   1. 角色人设卡（CodexEntry.summary + 别名 + status + events 最近 5 条）
//   2. 世界书（selectRelevantCodex：对话内容作 haystack，检索相关设定）
//   3. bible.tone（叙事文风/视角）
// 组装为系统提示，角色以第一人称回复。

import type { CodexEntry, Project } from "../types";
import { selectRelevantCodex } from "../retrieval";
import type { RoleplayCharacterCard, RoleplayMessage } from "./types";

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
