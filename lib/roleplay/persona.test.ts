// 纯逻辑单测：assembleRoleContext（swap/append、lorebook 注入、scenarioOverride、tone）。
// 注：本沙箱无法执行 vitest（二进制缺失），仅作类型/逻辑交付物，待 CI/本地 npm ci 后 npm test。

import { describe, expect, it } from "vitest";
import { assembleRoleContext } from "./persona";
import type { CharacterCardV2, LorebookEntry, RoleplayGroup } from "../tavern/types";
import type { ScannedEntry } from "./lorebook";

function makeCard(name: string, overrides: Partial<CharacterCardV2["data"]> = {}): CharacterCardV2 {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name,
      description: `${name} 是测试角色`,
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      system_prompt: "",
      alternate_greetings: [],
      tags: [],
      creator: "Novel&Chat",
      character_version: "1.0",
      ...overrides,
    },
    extensions: { novelchat: { codexId: name } },
  };
}

function makeScanned(content: string, key?: string): ScannedEntry {
  const entry: LorebookEntry = {
    id: `e-${content}`,
    keys: key ? [key] : [],
    content,
    enabled: true,
    insertion_order: 0,
  };
  return { entry, matchedKey: key, reason: "test", tokens: 1 };
}

describe("assembleRoleContext", () => {
  it("swap 模式只注入发言者，不含在场其他角色段", () => {
    const speaker = makeCard("A");
    const other = makeCard("B");
    const { systemPrompt } = assembleRoleContext(speaker, [], {
      generationMode: "swap",
      memberCards: [speaker, other],
    });
    expect(systemPrompt).toContain("你是「A」");
    expect(systemPrompt).not.toContain("在场的其他角色");
  });

  it("append 模式注入其他成员卡", () => {
    const speaker = makeCard("A");
    const other = makeCard("B", { description: "B 的描述" });
    const { systemPrompt } = assembleRoleContext(speaker, [], {
      generationMode: "append",
      memberCards: [speaker, other],
    });
    expect(systemPrompt).toContain("在场的其他角色");
    expect(systemPrompt).toContain("你是「B」");
  });

  it("lorebook 注入出现在世界书段", () => {
    const speaker = makeCard("A");
    const { systemPrompt, worldEntries } = assembleRoleContext(speaker, [
      makeScanned("魔法法则", "魔法"),
    ]);
    expect(worldEntries).toHaveLength(1);
    expect(systemPrompt).toContain("世界书（自动注入）");
    expect(systemPrompt).toContain("（命中「魔法」）魔法法则");
  });

  it("scenarioOverride 注入群组情境", () => {
    const speaker = makeCard("A");
    const group: RoleplayGroup = {
      id: "g1",
      name: "群",
      novelchat: { ownerId: "o", projectId: "p" },
      members: ["A"],
      disabledMembers: [],
      activationStrategy: "list",
      generationMode: "swap",
      scenarioOverride: "末日废土",
      allowSelfResponses: false,
    };
    const { systemPrompt } = assembleRoleContext(speaker, [], {
      group,
    });
    expect(systemPrompt).toContain("群组情境");
    expect(systemPrompt).toContain("末日废土");
  });

  it("tone 注入叙事文风", () => {
    const speaker = makeCard("A");
    const { systemPrompt } = assembleRoleContext(speaker, [], { tone: "冷峻写实" });
    expect(systemPrompt).toContain("叙事文风");
    expect(systemPrompt).toContain("冷峻写实");
  });

  it("constant 命中显示为 constant", () => {
    const speaker = makeCard("A");
    const constant: ScannedEntry = {
      entry: {
        id: "c",
        keys: [],
        content: "恒定量",
        enabled: true,
        insertion_order: 0,
        constant: true,
      },
      reason: "constant",
      tokens: 1,
    };
    const { systemPrompt } = assembleRoleContext(speaker, [constant]);
    expect(systemPrompt).toContain("（命中「constant」）恒定量");
  });
});
