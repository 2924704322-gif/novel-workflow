// @ts-nocheck
// lorebook 引擎单测（FT-17）。
//
// ⚠️ 沙箱限制：vitest 二进制损坏 + npm 被拦截，本文件「写好但未跑」。
// 非沙箱环境执行：npm ci && npm test（vitest run）。
// 类型检查用 // @ts-nocheck 跳过（node_modules 无 vitest 类型，避免 tsc 误报）。

import { describe, it, expect } from "vitest";
import {
  scanLorebook,
  matchKey,
  estimateTokens,
  type LorebookEntry,
  type ScannedEntry,
} from "./lorebook";

function entry(partial: Partial<LorebookEntry> & Pick<LorebookEntry, "id" | "keys" | "content">): LorebookEntry {
  return {
    enabled: true,
    insertion_order: 0,
    ...partial,
  } as LorebookEntry;
}

describe("estimateTokens", () => {
  it("中文约 1.6 字/token", () => {
    const t = estimateTokens("一二三四五六七八");
    expect(t).toBe(5); // 8 / 1.6 = 5
  });
  it("英文约 4 字/token", () => {
    const t = estimateTokens("abcd");
    expect(t).toBe(1); // 4/4 = 1
  });
  it("空串返回 0，非空至少 1", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("x")).toBe(1);
  });
});

describe("matchKey", () => {
  it("字面匹配默认大小写不敏感", () => {
    expect(matchKey("魔法少女", "魔法", false)).toBe(true);
    expect(matchKey("MAGIC", "magic", false)).toBe(true);
  });
  it("case_sensitive 时区分大小写", () => {
    expect(matchKey("MAGIC", "magic", true)).toBe(false);
    expect(matchKey("MAGIC", "MAGIC", true)).toBe(true);
  });
  it("空 key 不命中", () => {
    expect(matchKey("abc", "", false)).toBe(false);
  });
  it("正则 key 支持 /pattern/", () => {
    expect(matchKey("使用火球术攻击", "/火球|冰锥/", false)).toBe(true);
    expect(matchKey("使用治疗术", "/火球|冰锥/", false)).toBe(false);
  });
  it("正则 key 支持 flags 与 case_sensitive 覆盖", () => {
    expect(matchKey("Color", "/colou?r/i", false)).toBe(true);
    expect(matchKey("Color", "/colou?r/", true)).toBe(false); // 无 i 且大小写敏感
  });
  it("非法正则不抛错，视为无命中", () => {
    expect(matchKey("abc", "/(/", false)).toBe(false);
  });
});

describe("scanLorebook", () => {
  const msgs = ["你好，聊聊魔法吧", "他施展了火球术"];

  it("关键词命中按 insertion_order 升序返回", () => {
    const entries = [
      entry({ id: "b", keys: ["火球"], content: "火球术说明", insertion_order: 5 }),
      entry({ id: "a", keys: ["魔法"], content: "魔法概论", insertion_order: 1 }),
    ];
    const out = scanLorebook(entries, msgs);
    expect(out.map((m: ScannedEntry) => m.entry.id)).toEqual(["a", "b"]);
  });

  it("enabled=false 跳过", () => {
    const entries = [entry({ id: "x", keys: ["魔法"], content: "c", enabled: false })];
    expect(scanLorebook(entries, msgs)).toHaveLength(0);
  });

  it("constant 恒注入，不依赖关键词", () => {
    const entries = [entry({ id: "k", keys: [], content: "世界观常量", constant: true })];
    const out = scanLorebook(entries, ["无关内容"]);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toContain("constant");
  });

  it("selective 需全部 keys 与 secondary_keys 命中", () => {
    const ok = entry({
      id: "s1",
      keys: ["城堡"],
      secondary_keys: ["地下室"],
      content: "c",
      selective: true,
      insertion_order: 1,
    });
    const no = entry({
      id: "s2",
      keys: ["城堡"],
      secondary_keys: ["密道"],
      content: "c",
      selective: true,
      insertion_order: 2,
    });
    const out = scanLorebook([ok, no], ["他们在城堡的地下室发现了线索"]);
    expect(out.map((m: ScannedEntry) => m.entry.id)).toEqual(["s1"]);
  });

  it("token 预算超限时丢弃低优先级", () => {
    const entries = [
      entry({ id: "low", keys: ["魔法"], content: "低优先级长文本".repeat(40), priority: 20, insertion_order: 1 }),
      entry({ id: "high", keys: ["火球"], content: "高优先级", priority: 1, insertion_order: 2 }),
    ];
    const out = scanLorebook(entries, msgs, { tokenBudget: 20 });
    expect(out.map((m: ScannedEntry) => m.entry.id)).toContain("high");
    expect(out.map((m: ScannedEntry) => m.entry.id)).not.toContain("low");
  });

  it("constant 永不被裁，即使超出预算", () => {
    const entries = [
      entry({ id: "k", keys: [], content: "常量长文本".repeat(60), constant: true }),
      entry({ id: "low", keys: ["魔法"], content: "低优先", priority: 20, insertion_order: 2 }),
    ];
    const out = scanLorebook(entries, msgs, { tokenBudget: 10 });
    expect(out.map((m: ScannedEntry) => m.entry.id)).toEqual(["k"]);
  });

  it("recursive_scanning 触发引用条目", () => {
    const entries = [
      entry({ id: "trigger", keys: ["魔法"], content: "提及了贤者之石", insertion_order: 1 }),
      entry({ id: "ref", keys: ["贤者之石"], content: "贤者之石的秘密", insertion_order: 2 }),
    ];
    const out = scanLorebook(entries, ["我们讨论了魔法"], { recursiveScanning: true });
    expect(out.map((m: ScannedEntry) => m.entry.id).sort()).toEqual(["ref", "trigger"]);
  });

  it("scanDepth 限制扫描窗口", () => {
    const entries = [entry({ id: "x", keys: ["远古"], content: "c", insertion_order: 1 })];
    // P2-1 修复：关键词消息须放在「最旧」一端（实现取最近 N 条，slice(-scanDepth)），
    // 此前误 push 到末尾导致窗口必然命中、断言恒失败（测试用例 bug，非实现缺陷）。
    const many = ["这里提到了远古传说", ...Array.from({ length: 25 }, (_, i) => `消息${i}`)];
    // scanDepth=20 时，窗口为末 20 条，不含最旧的「远古」消息 → 不命中
    expect(scanLorebook(entries, many, { scanDepth: 20 })).toHaveLength(0);
    expect(scanLorebook(entries, many, { scanDepth: 30 })).toHaveLength(1);
  });
});
