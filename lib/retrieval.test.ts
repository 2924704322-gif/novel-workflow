// retrieval.ts 纯函数单测：多因子检索打分、分层前情、摘要回写合并。
// 不依赖网络 / LLM / 文件系统，全部使用内存 fixture。
import { describe, it, expect } from "vitest";
import {
  flattenChapters,
  selectRelevantCodex,
  buildChapterContext,
  applyDigest,
} from "./retrieval";
import type { CodexEntry } from "./types";
import { makeProject } from "./__tests__/fixtures";

function codex(name: string, extra: Partial<CodexEntry> = {}): CodexEntry {
  return {
    id: `k_${name}`,
    category: "人物",
    name,
    aliases: [],
    summary: "",
    updatedAtChapter: 0,
    events: [],
    ...extra,
  };
}

describe("flattenChapters", () => {
  it("按阅读顺序铺平并给出全局序号与上一章引用", () => {
    const p = makeProject();
    const flat = flattenChapters(p);
    expect(flat).toHaveLength(3);
    expect(flat.map((f) => f.global)).toEqual([1, 2, 3]);
    expect(flat[0].prev).toBeNull();
    expect(flat[1].prev?.id).toBe("c1");
    expect(flat[2].chapter.id).toBe("c4");
    expect(flat[2].volume.id).toBe("v2");
  });
});

describe("selectRelevantCodex（多因子打分）", () => {
  const codexList: CodexEntry[] = [
    codex("林惊蛰", { pinned: true }), // 核心：恒定注入
    codex("苏沉", { category: "人物" }),
    codex("玄天宗", { category: "势力" }),
    codex("青鸾剑", { category: "物品" }),
  ];

  it("核心/置顶条目即使未在正文命中也被恒定注入", () => {
    const out = selectRelevantCodex(codexList, "正文里只提到了路人甲", 0, [], 14);
    expect(out.map((e) => e.name)).toContain("林惊蛰");
    expect(out).toHaveLength(1);
  });

  it("按命中与类别加权排序（人物/势力加分）", () => {
    const text = "苏沉握住了青鸾剑";
    const out = selectRelevantCodex(codexList, text, 0, [], 14);
    // 林惊蛰（核心）恒在前，其次苏沉(人物, 2+1=3) > 青鸾剑(物品, 2)
    expect(out[0].name).toBe("林惊蛰");
    expect(out[1].name).toBe("苏沉");
    expect(out[2].name).toBe("青鸾剑");
  });

  it("Top-N 限额：核心恒定占用名额，其余按分数截断", () => {
    const text = "苏沉与玄天宗对峙，青鸾剑长鸣";
    // limit=2：核心占 1，剩余 1 个名额给分数最高的
    const out = selectRelevantCodex(codexList, text, 0, [], 2);
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("林惊蛰");
    expect(out[1].name).toBe("苏沉"); // 苏沉(3) 与 玄天宗(势力3) 并列，数组序优先
    expect(out.map((e) => e.name)).not.toContain("青鸾剑");
  });

  it("近期性加分：临近目标章的实体排名更靠前", () => {
    const recent = codex("玄天宗", { category: "势力", updatedAtChapter: 18 });
    const stale = codex("苏沉", { category: "人物", updatedAtChapter: 1 });
    const list = [codex("林惊蛰", { pinned: true }), recent, stale];
    // targetGlobal=20：gap(玄天宗)=2 ≤10 加 2；gap(苏沉)=19 不加
    const text = "玄天宗与苏沉";
    const out = selectRelevantCodex(list, text, 20, [], 14);
    const iX = out.findIndex((e) => e.name === "玄天宗");
    const iS = out.findIndex((e) => e.name === "苏沉");
    expect(iX).toBeLessThan(iS);
  });
});

describe("buildChapterContext（分层前情）", () => {
  it("注入核心角色、收集前情摘要、过滤已回收伏笔", () => {
    const p = makeProject();
    const ctx = buildChapterContext(p, "c4");
    // 前情：global < 4 且带摘要的章节 → c1、c2
    expect(ctx.recent.map((r) => r.title)).toEqual(["第一章", "第二章"]);
    // 伏笔：仅保留 planted / reinforced
    expect(ctx.foreshadows.map((f) => f.title)).toEqual(["剑冢之谜"]);
    // 核心角色恒定注入
    expect(ctx.codex.map((e) => e.name)).toContain("林惊蛰");
  });

  it("storySoFar / volumeArc 来自工程顶层与当前卷", () => {
    const p = makeProject();
    p.storySoFar = "全局故事梗概";
    p.volumes[1].arcSummary = "卷二滚动弧";
    const ctx = buildChapterContext(p, "c4");
    expect(ctx.storySoFar).toBe("全局故事梗概");
    expect(ctx.volumeArc).toBe("卷二滚动弧");
  });
});

describe("applyDigest（摘要回写 / 合并）", () => {
  it("回写章节摘要并按名合并信息库、按标题合并伏笔", () => {
    const p = makeProject();
    const next = applyDigest(p, "c1", {
      summary: "新写的摘要",
      codex: [
        {
          name: "林惊蛰",
          category: "人物",
          status: "存活",
          event: "于第一章觉醒",
        },
      ],
      foreshadows: [{ title: "剑冢之谜", action: "reinforce", detail: "线索强化" }],
    });
    expect(next.volumes[0].chapters[0].summary).toBe("新写的摘要");
    const lin = next.codex.find((e) => e.name === "林惊蛰");
    expect(lin?.status).toBe("存活");
    expect(lin?.events).toEqual([{ chapter: 1, note: "于第一章觉醒" }]);
    expect(lin?.updatedAtChapter).toBe(1);
    const fs = next.foreshadows.find((f) => f.title === "剑冢之谜");
    expect(fs?.status).toBe("reinforced");
    // 原工程未被改动（纯函数）
    expect(p.volumes[0].chapters[0].summary).toBe("第一章摘要");
  });

  it("新信息库条目按名新建；重复事件不重复追加（幂等合并）", () => {
    const p = makeProject();
    const once = applyDigest(p, "c1", {
      codex: [{ name: "苏沉", category: "人物", event: "登场" }],
    });
    const twice = applyDigest(once, "c1", {
      codex: [{ name: "苏沉", category: "人物", event: "登场" }],
    });
    const suOnce = once.codex.find((e) => e.name === "苏沉");
    const suTwice = twice.codex.find((e) => e.name === "苏沉");
    expect(suOnce?.events).toHaveLength(1);
    expect(suTwice?.events).toHaveLength(1); // 相同章节+相同 note 不重复
    // 仍只保留一条苏沉条目
    expect(twice.codex.filter((e) => e.name === "苏沉")).toHaveLength(1);
  });
});
