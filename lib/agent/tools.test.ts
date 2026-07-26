// agent/tools.ts 纯函数单测：Agent 确认流的 foldGenerated 折叠逻辑与幂等性。
// 不依赖网络 / LLM / 文件系统 / 仓储；仅验证「生成候选 → save 折叠 → 落库」的纯逻辑。
import { describe, it, expect, vi } from "vitest";
import { foldGenerated, type GeneratedCache } from "./tools";
import { emptyProject, type Project, type StoryBible } from "../types";

// foldGenerated 对 chapter / chapter_outline 会写入 updatedAt: Date.now()，
// 冻结时间以保证确定性 kind 的幂等性断言稳定（chapter_outline 因 rid() 仍非幂等）。
vi.useFakeTimers();

const bible: StoryBible = {
  logline: "内核",
  synopsis: "梗概",
  worldbuilding: "",
  themes: "",
  tone: "",
  characters: [],
};

function baseProject(): Project {
  const p = emptyProject("p", "书");
  p.bible = bible;
  p.volumes = [
    {
      id: "v1",
      index: 1,
      title: "第一卷",
      summary: "",
      plannedChapters: 2,
      chapters: [
        {
          id: "c1",
          index: 1,
          title: "第一章",
          synopsis: "",
          content: "",
          summary: "",
          wordCount: 0,
          status: "empty",
          updatedAt: 0,
        },
        {
          id: "c2",
          index: 2,
          title: "第二章",
          synopsis: "",
          content: "",
          summary: "",
          wordCount: 0,
          status: "empty",
          updatedAt: 0,
        },
      ],
    },
  ];
  return p;
}

describe("foldGenerated 幂等性（确定性 kind）", () => {
  it("bible 折叠：重复折叠结果完全一致", () => {
    const p = baseProject();
    const cache: GeneratedCache = {
      bible: { kind: "bible", payload: { bible, title: "新标题" }, at: 0 },
    };
    const a = foldGenerated(p, cache, ["bible"]);
    const b = foldGenerated(p, cache, ["bible"]);
    expect(b).toEqual(a);
    expect(a.patch.title).toBe("新标题");
    expect(a.keys).toContain("bible");
  });

  it("chapter 折叠：按 id 覆盖既有章节，不新增（可安全重复落库）", () => {
    const p = baseProject();
    const cache: GeneratedCache = {
      chapter: {
        kind: "chapter",
        payload: { chapterId: "c1", content: "正文", wordCount: 100 },
        at: 0,
      },
    };
    const a = foldGenerated(p, cache, ["chapter"]);
    const b = foldGenerated(p, cache, ["chapter"]);
    expect(b).toEqual(a);
    // 落库覆盖语义：同一 patch 应用两次，章节数不增、内容一致
    const apply = (base: Project) => ({ ...base, ...a.patch }) as Project;
    const r1 = apply(p);
    const r2 = apply(r1);
    expect(r2).toEqual(r1);
    expect(r2.volumes[0].chapters).toHaveLength(p.volumes[0].chapters.length);
    expect(r2.volumes[0].chapters[0].content).toBe("正文");
  });

  it("recap(book) 折叠：重复折叠结果一致", () => {
    const p = baseProject();
    const cache: GeneratedCache = {
      recap: { kind: "recap", payload: { mode: "book", text: "全书梗概" }, at: 0 },
    };
    const a = foldGenerated(p, cache, ["recap"]);
    const b = foldGenerated(p, cache, ["recap"]);
    expect(b).toEqual(a);
    expect(a.patch.storySoFar).toBe("全书梗概");
  });

  it("volumes 折叠：重复折叠结果一致", () => {
    const p = baseProject();
    const cache: GeneratedCache = {
      volumes: {
        kind: "volumes",
        payload: {
          volumes: [
            {
              id: "v1",
              index: 1,
              title: "重写后的第一卷",
              summary: "",
              plannedChapters: 2,
              chapters: [],
            },
          ],
        },
        at: 0,
      },
    };
    const a = foldGenerated(p, cache, ["volumes"]);
    const b = foldGenerated(p, cache, ["volumes"]);
    expect(b).toEqual(a);
  });
});

describe("foldGenerated 已知非幂等点（记录 / 回归保护）", () => {
  it("chapter_outline 每次折叠都会追加新章节（重复确认会重复添加）", () => {
    const p = baseProject(); // v1 原有 2 章
    const cache: GeneratedCache = {
      chapter_outline: {
        kind: "chapter_outline",
        payload: { volumeId: "v1", chapter: { title: "新章", synopsis: "概要" } },
        at: 0,
      },
    };
    const a = foldGenerated(p, cache, ["chapter_outline"]);
    const pA = { ...p, ...a.patch } as Project;
    const b = foldGenerated(pA, cache, ["chapter_outline"]);
    // 两次折叠各自新增一章（新章 id 由 rid() 生成，故非幂等）
    expect(a.patch.volumes![0].chapters).toHaveLength(3);
    expect(b.patch.volumes![0].chapters).toHaveLength(4);
  });
});
