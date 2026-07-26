// 酒馆AI · 角色卡数据模型 V2（FT-16）
//
// 职责：
//   1. CodexEntry（现有 Project.codex 中的「人物」条目）→ Character Card V2 映射
//      （对齐 SillyTavern Character Card V2 规范）。
//   2. 角色卡加载/回退：优先读 tavernStore 中已存 V2 卡；无卡则回退 codex→V2
//      （保证对话可跑）。
//   3. 角色卡持久化：写回 tavernStore（经 extensions.novelchat.codexId 关联）。
//
// ⚠️ Q4 关键约束（三方共存，不回写）：
//   - Project.codex 是「叙事/检索事实源」，本模块绝不反向写回 codex。
//   - 角色卡 V2 是「对话事实源」，存于 tavernStore。
//   - 设定 .md 是「可编辑上游」（FT-09/22 单向同步）。
//   三者通过 extensions.novelchat.codexId 关联，互不污染。
//
// GitHub 取经（SillyTavern Character Card V2）：
//   - spec/spec_version 为固定标识，不进 prompt。
//   - extensions 为「必须存在、默认 {}」的扩展槽，导入方不得破坏未知键；
//     自定义键需命名空间化 → 统一使用 extensions.novelchat。
//   - 本实现的 codexId/pinned/status/projectId/category 均挂在 novelchat 命名空间，
//     不破坏 V2 规范兼容性。

import type { CharacterCardV2 } from "../tavern/types";
import { tavernStore } from "../tavern/store";
import type { CodexEntry, Project } from "../types";

/**
 * 将 Project.codex 中的一条「人物」设定映射为最小可用的 Character Card V2。
 *
 * 字段映射（依据 novel-tavern-design.md §2 映射表）：
 *   - name            → data.name（直接）
 *   - summary + status→ data.description（description 回退自 summary；status 作为补充）
 *   - aliases         → data.tags（别名作标签，便于检索/展示）
 *   - personality/scenario/first_mes/mes_example/system_prompt
 *                     → 留空（codex 无独立来源；完整 V2 维度由 .md/编辑器补充，FT-09/22）
 *   - extensions.novelchat → { codexId, pinned, status, category }
 *
 * @param codex 必须是 category==="人物" 的 CodexEntry（调用方保证）。
 */
export function codexToCardV2(codex: CodexEntry): CharacterCardV2 {
  const descriptionParts: string[] = [];
  if (codex.summary) descriptionParts.push(codex.summary);
  if (codex.status) descriptionParts.push(`当前状态：${codex.status}`);
  const description = descriptionParts.join("\n");

  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: codex.name,
      description,
      // 无独立性格字段来源，留空待 .md/编辑器补充（Q4 不回写 codex）。
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      system_prompt: "",
      alternate_greetings: [],
      // 别名作为角色级 tags（可选，便于检索/展示）。
      tags: codex.aliases && codex.aliases.length ? [...codex.aliases] : [],
      creator: "Novel&Chat",
      character_version: "1.0",
    },
    extensions: {
      novelchat: {
        codexId: codex.id,
        pinned: codex.pinned,
        status: codex.status,
        category: codex.category,
      },
    },
  };
}

/**
 * 回退：当 codexId 在 project 中找不到对应 codex 时，生成仅含 codexId 的
 * 最小 V2 卡，保证对话仍可跑（极端兼容路径）。
 */
function fallbackCardFromId(codexId: string): CharacterCardV2 {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: codexId,
      description: "",
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      system_prompt: "",
      alternate_greetings: [],
      tags: [],
      creator: "Novel&Chat",
      character_version: "1.0",
    },
    extensions: { novelchat: { codexId } },
  };
}

/**
 * 加载角色卡：优先读 tavernStore 中已存的 V2 卡；若无卡，则回退
 * codexToCardV2(codex) 生成最小 V2 卡（兼容，保证对话可跑）。
 *
 * @param codexId 角色卡主键（= CodexEntry.id）。
 * @param project 可选；回退生成时需要从 project.codex 解析 CodexEntry。
 *                 若不传且 tavernStore 中无卡，则抛出明确错误（无法解析 codex）。
 *
 * Q4 不回写：本函数只「读/回退生成」，不修改 project.codex。
 */
export async function loadCharacter(
  codexId: string,
  project?: Project
): Promise<CharacterCardV2> {
  const stored = await tavernStore.readCharacter(codexId);
  if (stored) return stored;

  if (!project) {
    throw new Error(
      `未找到 codexId=${codexId} 的已存角色卡，且未提供 project 以回退生成`
    );
  }
  const codex = project.codex.find((e) => e.id === codexId);
  if (!codex) {
    // 极端兼容：codex 缺失也返回最小卡，保证对话可跑。
    return fallbackCardFromId(codexId);
  }
  return codexToCardV2(codex);
}

/**
 * 保存角色卡到 tavernStore（经 extensions.novelchat.codexId 关联）。
 *
 * @throws 若 card.extensions.novelchat.codexId 缺失（store 层会校验）。
 */
export async function saveCharacter(card: CharacterCardV2): Promise<void> {
  if (!card.extensions?.novelchat?.codexId) {
    throw new Error("saveCharacter 需要 extensions.novelchat.codexId");
  }
  await tavernStore.saveCharacter(card);
}

/**
 * 将 Character Card V2 的 data 字段拼为「人设段」纯文本（供 FT-19 persona 合并）。
 *
 * 顺序对齐 SillyTavern：身份(name/description) → 性格 → 情境 → 开场白 →
 * 示例对话 → 卡级系统提示。空字段跳过。
 */
export function cardToPersonaBlock(card: CharacterCardV2): string {
  const d = card.data;
  const parts: string[] = [`## 你的身份`, `你是「${d.name}」。`, d.description];

  if (d.personality) parts.push(`\n## 性格\n${d.personality}`);
  if (d.scenario) parts.push(`\n## 情境\n${d.scenario}`);
  if (d.first_mes) parts.push(`\n## 开场白\n${d.first_mes}`);
  if (d.mes_example) parts.push(`\n## 示例对话\n${d.mes_example}`);
  if (d.system_prompt) parts.push(`\n## 系统提示\n${d.system_prompt}`);

  return parts.filter((s) => s.trim().length > 0).join("\n").trim();
}
