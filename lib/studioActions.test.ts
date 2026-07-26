import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 确认写入落稿数据流（FT-09）逻辑测试：resolveChapter 定位 + applyMdDraftToStorage 落盘。
// 用真实 repository / docsStore 在临时根下跑，隔离验证章节/设定两条路径。

import { emptyProject, type Project } from "./types";
import { projectRepository, LOCAL_OWNER } from "./repository";

let actions: typeof import("./studioActions");
let docsMod: typeof import("./docsStore");
let TMP: string;

beforeAll(async () => {
  TMP = mkdtempSync(path.join(tmpdir(), "novel-act-"));
  process.env.NOVEL_DATA_ROOT = TMP;
  docsMod = await import("./docsStore");
  actions = await import("./studioActions");
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  delete process.env.NOVEL_DATA_ROOT;
});

function seed(): Project {
  const p = emptyProject("act_book", "动作书");
  p.volumes = [
    {
      id: "v1",
      index: 1,
      title: "卷一",
      summary: "",
      plannedChapters: 1,
      chapters: [
        {
          id: "c1",
          index: 1,
          title: "第一章",
          synopsis: "",
          content: "旧内容",
          summary: "",
          wordCount: 3,
          status: "done",
          updatedAt: 0,
        },
      ],
    },
  ];
  return p;
}

describe("resolveChapter", () => {
  it("按 targetChapterId 精确命中", () => {
    const p = seed();
    const loc = actions.resolveChapter(p, {
      fileName: "第1章.md",
      kind: "chapter",
      targetChapterId: "c1",
      body: "",
    });
    expect(loc).toEqual({ volId: "v1", chId: "c1" });
  });

  it("无 id 时按 fileName「第N章」模糊兜底", () => {
    const p = seed();
    const loc = actions.resolveChapter(p, {
      fileName: "第1章_初稿.md",
      kind: "chapter",
      body: "",
    });
    expect(loc?.chId).toBe("c1");
  });

  it("无匹配章节时回退首卷首章", () => {
    const p = emptyProject("empty", "空书");
    const loc = actions.resolveChapter(p, {
      fileName: "第9章.md",
      kind: "chapter",
      body: "",
    });
    expect(loc).toBeNull();
  });
});

describe("applyMdDraftToStorage", () => {
  it("章节类落盘到 chapter.content 并标记 done / 统计字数", async () => {
    const p = seed();
    await projectRepository.save(LOCAL_OWNER, p);
    const res = await actions.applyMdDraftToStorage("act_book", {
      fileName: "第1章.md",
      kind: "chapter",
      targetChapterId: "c1",
      body: "全新正文内容",
    });
    expect(res.chId).toBe("c1");

    const re = await projectRepository.get(LOCAL_OWNER, "act_book");
    expect(re!.volumes[0].chapters[0].content).toBe("全新正文内容");
    expect(re!.volumes[0].chapters[0].status).toBe("done");
    expect(re!.volumes[0].chapters[0].wordCount).toBeGreaterThan(0);
  });

  it("设定类落 docsStore 并回填 bible（单向同步）", async () => {
    const p = seed();
    p.bible = {
      logline: "",
      synopsis: "",
      worldbuilding: "",
      themes: "",
      tone: "",
      characters: [],
    };
    await projectRepository.save(LOCAL_OWNER, p);
    const res = await actions.applyMdDraftToStorage("act_book", {
      fileName: "世界观.md",
      kind: "setting",
      settingKind: "world",
      body: "# 世界观\n落地世界观",
    });
    expect(res.fileName).toBe("世界观.md");

    const doc = await docsMod.docsStore.read("act_book", "世界观.md");
    expect(doc!.body).toBe("# 世界观\n落地世界观");

    const re = await projectRepository.get(LOCAL_OWNER, "act_book");
    expect(re!.bible!.worldbuilding).toBe("落地世界观");
  });
});
