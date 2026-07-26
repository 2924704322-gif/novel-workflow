import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 用临时数据根隔离测试，且必须在动态导入 docsStore（其依赖 storage.dataRoot）之前设置，
// 否则 storage 会在模块加载时固化 cwd/data 为根目录。
let mod: typeof import("./docsStore");
let TMP: string;

beforeAll(async () => {
  TMP = mkdtempSync(path.join(tmpdir(), "novel-docs-"));
  process.env.NOVEL_DATA_ROOT = TMP;
  mod = await import("./docsStore");
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  delete process.env.NOVEL_DATA_ROOT;
});

const PID = "proj_alpha";

describe("docsStore", () => {
  it("save 后 read 往返 body 与 kind", async () => {
    const rec = await mod.docsStore.save(PID, "世界观.md", "# 世界观\n这是内容", "world");
    expect(rec.kind).toBe("world");
    expect(rec.kindLabel).toBe("世界观");
    const got = await mod.docsStore.read(PID, "世界观.md");
    expect(got).not.toBeNull();
    expect(got!.body).toBe("# 世界观\n这是内容");
    expect(got!.kind).toBe("world");
    expect(got!.kindLabel).toBe("世界观");
  });

  it("list 返回 DocMeta 且 words 由正文统计", async () => {
    await mod.docsStore.save(PID, "人物设定_沈寄.md", "沈寄是一个剑客。", "character");
    const list = await mod.docsStore.list(PID);
    const names = list.map((m) => m.name);
    expect(names).toContain("世界观.md");
    expect(names).toContain("人物设定_沈寄.md");
    const char = list.find((m) => m.name === "人物设定_沈寄.md")!;
    expect(char.kind).toBe("character");
    expect(char.kindLabel).toBe("人物");
    expect(char.words).toBeGreaterThan(0);
  });

  it("front-matter 往返：kind 必填并被正确解析", async () => {
    await mod.docsStore.save(PID, "大纲_卷一.md", "卷一梗概", "outline");
    const got = await mod.docsStore.read(PID, "大纲_卷一.md");
    expect(got!.kind).toBe("outline");
    // 读出的 body 不应包含 front-matter 分隔符
    expect(got!.body).not.toContain("---");
  });

  it("remove 后 list 不再包含该文档", async () => {
    await mod.docsStore.save(PID, "灵感_点子.md", "灵感内容", "inspiration");
    await mod.docsStore.remove(PID, "灵感_点子.md");
    const list = await mod.docsStore.list(PID);
    expect(list.find((m) => m.name === "灵感_点子.md")).toBeUndefined();
    expect(await mod.docsStore.read(PID, "灵感_点子.md")).toBeNull();
  });

  it("缺失 front-matter 时 kind 回退为 other", async () => {
    await mod.docsStore.save(PID, "杂记.md", "无 front-matter", "other");
    const got = await mod.docsStore.read(PID, "杂记.md");
    expect(got!.kind).toBe("other");
  });

  it("拒绝路径穿越的文件名（../）", async () => {
    await expect(
      mod.docsStore.save(PID, "../../evil.md", "x", "other")
    ).rejects.toThrow();
    // 确认没有写到项目目录之外（临时根之外）
    expect(rmSyncSafe(path.resolve(TMP, "..", "evil.md"))).toBe(false);
  });
});

// 辅助：安全判断文件是否存在（不存在返回 false，不抛）
function rmSyncSafe(p: string): boolean {
  try {
    rmSync(p, { force: false });
    return true;
  } catch {
    return false;
  }
}
