// @ts-nocheck
// 单向同步缝单测（FT-23）。
//
// ⚠️ 沙箱限制：vitest 二进制损坏 + npm 被拦截，本文件「写好但未跑」；
// 非沙箱执行：npm ci && npm test（vitest run）。
// 用 // @ts-nocheck 跳过类型（node_modules 无 vitest 类型且需 mock 注入）。
//
// 策略：mock docsStore / tavernStore 为内存实现（docsStore.save/remove 直接抛错，
// 以强制验证 Q5 不回写 .md）；保留真实 characterCard 模块，验证
// sync → characterCard → tavernStore 的真实集成路径。

import { describe, it, expect, vi } from "vitest";

// 共享内存状态（vi.hoisted 保证在 vi.mock 工厂前初始化，可安全被工厂引用）。
const h = vi.hoisted(() => ({
  docs: new Map<string, any>(),
  lorebooks: new Map<string, any>(),
  characters: new Map<string, any>(),
}));

function clone<T>(x: T): T {
  return x == null ? x : JSON.parse(JSON.stringify(x));
}

// mock docsStore：list/read 走内存；save/remove 直接抛错 —— 确保 sync 绝不回写 .md（Q5）。
vi.mock("../docsStore", () => ({
  docsStore: {
    list: async (projectId: string) => {
      const out: any[] = [];
      for (const [k, v] of h.docs) {
        if (k.startsWith(projectId + "::")) {
          out.push({ name: v.name, kind: v.kind, kindLabel: "", words: 0, updatedAt: 0 });
        }
      }
      return out;
    },
    read: async (projectId: string, name: string) => {
      return h.docs.get(projectId + "::" + name) ?? null;
    },
    save: async () => {
      throw new Error("Q5 violation: docsStore.save must not be called by sync");
    },
    remove: async () => {
      throw new Error("Q5 violation: docsStore.remove must not be called by sync");
    },
  },
}));

// mock tavernStore：内存实现；save 深拷贝落库，避免引用透传污染断言。
vi.mock("./store", () => ({
  tavernStore: {
    readLorebook: async (id: string) => clone(h.lorebooks.get(id) ?? null),
    saveLorebook: async (book: any) => {
      h.lorebooks.set(book.id, clone(book));
    },
    readCharacter: async (codexId: string) => clone(h.characters.get(codexId) ?? null),
    saveCharacter: async (card: any) => {
      if (!card?.extensions?.novelchat?.codexId) {
        throw new Error("missing codexId");
      }
      h.characters.set(card.extensions.novelchat.codexId, clone(card));
    },
    listCharacters: async () => [],
    listLorebooks: async () => [],
  },
}));

// 真实 characterCard 模块（loadCharacter/saveCharacter）与上面的 mock tavernStore 联动；
// 不 mock 它，以验证 sync → characterCard → tavernStore 的真实集成路径。

function docRec(name: string, kind: string, body: string): any {
  return { name, kind, kindLabel: "", words: 0, updatedAt: 0, body };
}

function makeProject(over: any = {}): any {
  return {
    id: "p1",
    title: "T",
    phase: "writing",
    setup: {},
    bible: null,
    volumes: [],
    codex: [],
    foreshadows: [],
    prompts: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

import { syncDocsToTavern, syncDocToTavern } from "./sync";

describe("syncDocsToTavern · world docs", () => {
  it("world doc → lorebook entry created with content; re-run idempotent (no dup, keys preserved)", async () => {
    h.docs.clear();
    h.lorebooks.clear();
    h.characters.clear();
    h.docs.set("p1::世界观.md", docRec("世界观.md", "world", "# 世界观\n内容A"));

    const project = makeProject({ id: "p1" });
    const r1 = await syncDocsToTavern(project, "owner1");
    expect(r1.worldDocs).toBe(1);
    expect(r1.worldLorebookId).toBe("world-p1");
    expect(r1.skipped).toBe(0);

    const book = h.lorebooks.get("world-p1");
    expect(book).toBeTruthy();
    expect(book.entries).toHaveLength(1);
    expect(book.entries[0].content).toBe("# 世界观\n内容A");
    expect(book.entries[0].novelchat.sourceDoc).toBe("世界观.md");
    expect(book.entries[0].name).toBe("世界观");
    expect(book.novelchat).toEqual({ ownerId: "owner1", projectId: "p1", kind: "project" });

    // 模拟人工维护字段（keys/insertion_order），再跑一次：应保留且不再重复建 entry。
    book.entries[0].keys = ["魔法", "剑"];
    book.entries[0].insertion_order = 7;
    h.lorebooks.set("world-p1", book);

    const r2 = await syncDocsToTavern(project, "owner1");
    expect(r2.worldDocs).toBe(1);
    const book2 = h.lorebooks.get("world-p1");
    expect(book2.entries).toHaveLength(1); // 无重复 entry
    expect(book2.entries[0].content).toBe("# 世界观\n内容A"); // 内容保持最新
    expect(book2.entries[0].keys).toEqual(["魔法", "剑"]); // 人工 keys 保留
    expect(book2.entries[0].insertion_order).toBe(7); // 人工 order 保留
  });
});

describe("syncDocsToTavern · character docs", () => {
  it("character doc → card.description updated, other fields preserved", async () => {
    h.docs.clear();
    h.lorebooks.clear();
    h.characters.clear();
    // 预置一张已存角色卡（含 personality/scenario 等人设维度）。
    h.characters.set("c1", {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "沈寄",
        description: "旧描述",
        personality: "冷静",
        scenario: "S",
        first_mes: "",
        mes_example: "",
        system_prompt: "",
        alternate_greetings: [],
        tags: [],
        creator: "x",
        character_version: "1.0",
      },
      extensions: { novelchat: { codexId: "c1" } },
    });
    h.docs.set("p1::人物设定_沈寄.md", docRec("人物设定_沈寄.md", "character", "新的人设描述"));

    const project = makeProject({
      id: "p1",
      codex: [{ id: "c1", category: "人物", name: "沈寄", aliases: [], summary: "", status: "存活" }],
    });
    const r = await syncDocsToTavern(project, "owner1");
    expect(r.characterDocs).toBe(1);

    const card = h.characters.get("c1");
    expect(card.data.description).toBe("新的人设描述"); // 仅 description 被覆盖
    expect(card.data.personality).toBe("冷静"); // 保留
    expect(card.data.scenario).toBe("S"); // 保留
    expect(card.data.name).toBe("沈寄"); // 保留
  });

  it("character doc with no matching codex entry is skipped (no card written)", async () => {
    h.docs.clear();
    h.lorebooks.clear();
    h.characters.clear();
    h.docs.set("p1::人物设定_路人.md", docRec("人物设定_路人.md", "character", "x"));
    const project = makeProject({ id: "p1", codex: [] });
    const r = await syncDocsToTavern(project, "owner1");
    expect(r.characterDocs).toBe(0);
    expect(h.characters.size).toBe(0); // 无 codexId 链接，不写卡片
  });
});

describe("syncDocsToTavern · skipped kinds", () => {
  it("outline/inspiration/other docs counted as skipped, no lorebook shell", async () => {
    h.docs.clear();
    h.lorebooks.clear();
    h.characters.clear();
    h.docs.set("p1::大纲.md", docRec("大纲.md", "outline", "x"));
    h.docs.set("p1::灵感.md", docRec("灵感.md", "inspiration", "y"));
    h.docs.set("p1::其它.md", docRec("其它.md", "other", "z"));

    const project = makeProject({ id: "p1" });
    const r = await syncDocsToTavern(project, "owner1");
    expect(r.skipped).toBe(3);
    expect(r.worldDocs).toBe(0);
    expect(r.characterDocs).toBe(0);
    expect(h.lorebooks.get("world-p1")).toBeUndefined(); // 无世界文档不建空壳
  });
});

describe("syncDocsToTavern · Q4/Q5 non-regression", () => {
  it("no codex mutation, no .md write (docsStore.save/remove would throw)", async () => {
    h.docs.clear();
    h.lorebooks.clear();
    h.characters.clear();
    h.docs.set("p1::人物设定_沈寄.md", docRec("人物设定_沈寄.md", "character", "desc"));
    h.docs.set("p1::世界观.md", docRec("世界观.md", "world", "w"));

    const codex = [
      { id: "c1", category: "人物", name: "沈寄", aliases: [], summary: "", status: "存活" },
    ];
    const project = makeProject({ id: "p1", codex });

    const r = await syncDocsToTavern(project, "owner1");

    // Q4：codex 数组引用与内容完全未被改动（sync 只读不写 codex）。
    expect(project.codex).toBe(codex);
    expect(project.codex).toEqual([
      { id: "c1", category: "人物", name: "沈寄", aliases: [], summary: "", status: "存活" },
    ]);

    // 到达此处说明 docsStore.save/remove 未被调用（否则已抛错）—— Q5 不回写 .md。
    expect(r.characterDocs).toBe(1);
    expect(r.worldDocs).toBe(1);
  });
});

describe("syncDocToTavern · single doc", () => {
  it("sync single world doc is idempotent (no dup entry)", async () => {
    h.docs.clear();
    h.lorebooks.clear();
    h.characters.clear();
    h.docs.set("p1::世界观.md", docRec("世界观.md", "world", "W"));

    const project = makeProject({ id: "p1" });
    const r1 = await syncDocToTavern(project, "owner1", "世界观.md");
    expect(r1.worldDocs).toBe(1);
    const r2 = await syncDocToTavern(project, "owner1", "世界观.md");
    expect(r2.worldDocs).toBe(1);
    const book = h.lorebooks.get("world-p1");
    expect(book.entries).toHaveLength(1); // 单次同步也幂等，无重复
  });

  it("sync single character doc updates only description", async () => {
    h.docs.clear();
    h.lorebooks.clear();
    h.characters.clear();
    h.characters.set("c1", {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "沈寄",
        description: "旧",
        personality: "P",
        scenario: "S",
        first_mes: "",
        mes_example: "",
        system_prompt: "",
        alternate_greetings: [],
        tags: [],
        creator: "x",
        character_version: "1.0",
      },
      extensions: { novelchat: { codexId: "c1" } },
    });
    h.docs.set("p1::人物设定_沈寄.md", docRec("人物设定_沈寄.md", "character", "新"));

    const project = makeProject({
      id: "p1",
      codex: [{ id: "c1", category: "人物", name: "沈寄", aliases: [], summary: "", status: "存活" }],
    });
    const r = await syncDocToTavern(project, "owner1", "人物设定_沈寄.md");
    expect(r.characterDocs).toBe(1);
    const card = h.characters.get("c1");
    expect(card.data.description).toBe("新");
    expect(card.data.personality).toBe("P"); // 保留
  });

  it("sync single non-tavern doc counts as skipped", async () => {
    h.docs.clear();
    h.lorebooks.clear();
    h.characters.clear();
    h.docs.set("p1::大纲.md", docRec("大纲.md", "outline", "x"));

    const project = makeProject({ id: "p1" });
    const r = await syncDocToTavern(project, "owner1", "大纲.md");
    expect(r.skipped).toBe(1);
    expect(r.worldDocs).toBe(0);
    expect(r.characterDocs).toBe(0);
  });

  it("sync missing doc returns all zeros", async () => {
    h.docs.clear();
    h.lorebooks.clear();
    h.characters.clear();
    const project = makeProject({ id: "p1" });
    const r = await syncDocToTavern(project, "owner1", "不存在.md");
    expect(r).toEqual({ worldDocs: 0, characterDocs: 0, skipped: 0, worldLorebookId: "world-p1" });
  });
});
