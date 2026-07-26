// types.ts 纯函数单测：提示词库记录 / 启用筛选 / 字数统计 / 空工程。
// 不依赖网络或文件系统。
import { describe, it, expect } from "vitest";
import {
  recordPromptEntry,
  enabledPrompts,
  countWords,
  emptyProject,
  type PromptSource,
} from "./types";

describe("recordPromptEntry（提示词库记录 / 去重）", () => {
  it("空内容原样返回（引用不变）", () => {
    const p = emptyProject("p", "书");
    expect(recordPromptEntry(p, "prose", "   ")).toBe(p);
    expect(recordPromptEntry(p, "prose", "")).toBe(p);
  });

  it("新增条目置顶且默认启用", () => {
    const p = emptyProject("p", "书");
    const next = recordPromptEntry(p, "prose", "更克制些", "第3章");
    expect(next.prompts).toHaveLength(1);
    expect(next.prompts[0].content).toBe("更克制些");
    expect(next.prompts[0].enabled).toBe(true);
    expect(next.prompts[0].note).toBe("第3章");
    expect(next.prompts[0].source).toBe<PromptSource>("prose");
  });

  it("同来源同内容去重：置顶刷新而非叠加", () => {
    let p = emptyProject("p", "书");
    p = recordPromptEntry(p, "prose", "方向A");
    p = recordPromptEntry(p, "prose", "方向B");
    expect(p.prompts).toHaveLength(2);
    // 重复记录“方向A”不应新增，只置顶
    const next = recordPromptEntry(p, "prose", "方向A", "备注更新");
    expect(next.prompts).toHaveLength(2);
    expect(next.prompts[0].content).toBe("方向A");
    expect(next.prompts[0].note).toBe("备注更新");
    // 原工程未被改动：置顶的是新工程 next，原工程 p 仍是「方向B」置顶、方向A 无备注
    expect(p.prompts[0].content).toBe("方向B");
    expect(p.prompts.find((x) => x.content === "方向A")?.note).toBe("");
  });

  it("重复确认同一来源+内容不膨胀（幂等）", () => {
    let p = emptyProject("p", "书");
    for (let i = 0; i < 3; i++) p = recordPromptEntry(p, "manual", "固定方向");
    expect(p.prompts).toHaveLength(1);
  });
});

describe("enabledPrompts / countWords", () => {
  it("enabledPrompts 仅返回启用且非空条目", () => {
    let p = emptyProject("p", "书");
    p = recordPromptEntry(p, "manual", "启用项");
    p.prompts.push({ ...p.prompts[0], id: "x", enabled: false, content: "禁用项" });
    const en = enabledPrompts(p);
    expect(en).toHaveLength(1);
    expect(en[0].content).toBe("启用项");
  });

  it("countWords 按去空白字符数计（中文以字计）", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("abc def")).toBe(6);
    expect(countWords("春 风 十 里")).toBe(4);
  });
});
