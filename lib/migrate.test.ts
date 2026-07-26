import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 用临时数据根隔离；必须在设置 NOVEL_DATA_ROOT 后动态导入，
// 否则 storage 在模块加载时固化默认根（data/cwd）。
import { emptyProject, type Project, type StoryBible } from "./types";
import { projectRepository, LOCAL_OWNER } from "./repository";

let migrate: typeof import("./migrate");
let docsMod: typeof import("./docsStore");
let TMP: string;

beforeAll(async () => {
  TMP = mkdtempSync(path.join(tmpdir(), "novel-mig-"));
  process.env.NOVEL_DATA_ROOT = TMP;
  docsMod = await import("./docsStore");
  migrate = await import("./migrate");
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  delete process.env.NOVEL_DATA_ROOT;
});

function makeProject(): Project {
  const p = emptyProject("book_x", "测试书");
  const bible: StoryBible = {
    logline: "内核",
    synopsis: "梗概",
    worldbuilding: "世界观内容",
    themes: "主题",
    tone: "文风",
    characters: [{ name: "张三", role: "主角", profile: "小传" }],
  };
  p.bible = bible;
  p.volumes = [
    {
      id: "v1",
      index: 1,
      title: "卷一",
      summary: "卷概",
      plannedChapters: 1,
      chapters: [
        {
          id: "c1",
          index: 1,
          title: "第一章",
          synopsis: "章概",
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

describe("migrateBibleToDocs", () => {
  it("把 bible 拆为 世界观/人物设定_*/大纲 且命名正确", async () => {
    const p = makeProject();
    await projectRepository.save(LOCAL_OWNER, p);
    const metas = await migrate.migrateBibleToDocs(p);
    const names = metas.map((m) => m.name).sort();
    // 中文按码点排序：世(4E16) < 人(4EBA) < 大(5927)
    expect(names).toEqual(["世界观.md", "人物设定_张三.md", "大纲.md"]);

    const list = await docsMod.docsStore.list("book_x");
    expect(list.map((m) => m.name).sort()).toEqual([
      "世界观.md",
      "人物设定_张三.md",
      "大纲.md",
    ]);

    const world = await docsMod.docsStore.read("book_x", "世界观.md");
    expect(world!.body).toContain("世界观内容");
    const char = await docsMod.docsStore.read("book_x", "人物设定_张三.md");
    expect(char!.body).toContain("小传");
    const outline = await docsMod.docsStore.read("book_x", "大纲.md");
    expect(outline!.body).toContain("卷一");
  });

  it("幂等：二次调用不重复写、文件数不变", async () => {
    const p = makeProject();
    await projectRepository.save(LOCAL_OWNER, p);
    await migrate.migrateBibleToDocs(p);
    const first = await docsMod.docsStore.list("book_x");
    const metas2 = await migrate.migrateBibleToDocs(p);
    const second = await docsMod.docsStore.list("book_x");
    expect(second.length).toBe(first.length);
    expect(metas2.length).toBe(first.length);
  });

  it("bible 为 null 时返回空（不写任何 .md）", async () => {
    const p = emptyProject("book_null", "无bible");
    const metas = await migrate.migrateBibleToDocs(p);
    expect(metas).toEqual([]);
  });
});

describe("syncDocsToBible", () => {
  it("设定类 .md 回填 bible 对应切片（单向）", async () => {
    const p = makeProject();
    await projectRepository.save(LOCAL_OWNER, p);

    await migrate.syncDocsToBible(p, {
      fileName: "世界观.md",
      kind: "setting",
      settingKind: "world",
      body: "# 世界观\n新世界观",
    });
    expect(p.bible!.worldbuilding).toBe("新世界观");

    await migrate.syncDocsToBible(p, {
      fileName: "人物设定_张三.md",
      kind: "setting",
      settingKind: "character",
      body: "# 人物\n新小传",
    });
    expect(p.bible!.characters[0].profile).toBe("新小传");

    await migrate.syncDocsToBible(p, {
      fileName: "大纲_卷一.md",
      kind: "setting",
      settingKind: "outline",
      body: "# 大纲\n新梗概",
    });
    expect(p.bible!.synopsis).toBe("新梗概");
  });

  it("章节类不回填 bible（bible 缓存不变）", async () => {
    const p = makeProject();
    await projectRepository.save(LOCAL_OWNER, p);
    await migrate.syncDocsToBible(p, {
      fileName: "第1章.md",
      kind: "chapter",
      targetChapterId: "c1",
      body: "正文",
    });
    expect(p.bible!.worldbuilding).toBe("世界观内容");
  });
});
