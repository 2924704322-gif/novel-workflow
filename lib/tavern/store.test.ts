import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 临时数据根隔离；必须在动态导入 tavern/store（依赖 storage.dataRoot）前设置。
let mod: typeof import("./store");
let TMP: string;

beforeAll(async () => {
  TMP = mkdtempSync(path.join(tmpdir(), "novel-tavern-"));
  process.env.NOVEL_DATA_ROOT = TMP;
  mod = await import("./store");
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  delete process.env.NOVEL_DATA_ROOT;
});

function makeCard(codexId: string, ownerId: string): import("./types").CharacterCardV2 {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: `角色${codexId}`,
      description: "desc",
      personality: "pers",
      scenario: "scn",
      first_mes: "hi",
      mes_example: "ex",
      system_prompt: "sys",
      alternate_greetings: [],
      tags: ["t"],
      creator: "me",
    },
    extensions: { novelchat: { codexId, ownerId } },
  };
}

function makeLorebook(id: string, ownerId: string, projectId?: string) {
  return {
    id,
    novelchat: { ownerId, projectId, kind: "project" as const },
    entries: [],
  };
}

function makeGroup(id: string, ownerId: string, projectId: string) {
  return {
    id,
    name: `群${id}`,
    novelchat: { ownerId, projectId },
    members: [],
    disabledMembers: [],
    activationStrategy: "manual" as const,
    generationMode: "swap" as const,
    allowSelfResponses: false,
  };
}

describe("tavernStore", () => {
  it("角色卡 save/read/list/remove 往返", async () => {
    await mod.tavernStore.saveCharacter(makeCard("c1", "local"));
    const meta = await mod.tavernStore.listCharacters("local");
    expect(meta.map((m) => m.codexId)).toContain("c1");
    const got = await mod.tavernStore.readCharacter("c1");
    expect(got).not.toBeNull();
    expect(got!.data.name).toBe("角色c1");
    expect(got!.extensions!.novelchat!.codexId).toBe("c1");
    await mod.tavernStore.removeCharacter("c1");
    expect(await mod.tavernStore.readCharacter("c1")).toBeNull();
  });

  it("ownerId 过滤：不同租户不可见彼此角色卡", async () => {
    await mod.tavernStore.saveCharacter(makeCard("alice", "ownerA"));
    const mine = await mod.tavernStore.listCharacters("ownerA");
    const others = await mod.tavernStore.listCharacters("ownerB");
    expect(mine.map((m) => m.codexId)).toContain("alice");
    expect(others.find((m) => m.codexId === "alice")).toBeUndefined();
  });

  it("世界书 save/list 且按 projectId 过滤", async () => {
    await mod.tavernStore.saveLorebook(makeLorebook("lb1", "local", "p1"));
    await mod.tavernStore.saveLorebook(makeLorebook("lb2", "local", "p2"));
    const all = await mod.tavernStore.listLorebooks("local");
    expect(all.map((b) => b.id).sort()).toEqual(["lb1", "lb2"]);
    const p1 = await mod.tavernStore.listLorebooks("local", "p1");
    expect(p1.map((b) => b.id)).toEqual(["lb1"]);
    const p2 = await mod.tavernStore.listLorebooks("local", "p2");
    expect(p2.map((b) => b.id)).toEqual(["lb2"]);
    await mod.tavernStore.removeLorebook("lb1");
    expect((await mod.tavernStore.listLorebooks("local", "p1")).length).toBe(0);
  });

  it("群组 save/list 且按 projectId 过滤", async () => {
    await mod.tavernStore.saveGroup(makeGroup("g1", "local", "p1"));
    const p1 = await mod.tavernStore.listGroups("local", "p1");
    expect(p1.map((g) => g.id)).toEqual(["g1"]);
    const p2 = await mod.tavernStore.listGroups("local", "p2");
    expect(p2.length).toBe(0);
    await mod.tavernStore.removeGroup("g1");
    expect((await mod.tavernStore.listGroups("local", "p1")).length).toBe(0);
  });

  it("拒绝角色卡 codexId 路径穿越（../）", async () => {
    await expect(
      mod.tavernStore.saveCharacter(makeCard("../../etc/pwn", "local"))
    ).rejects.toThrow();
  });

  it("拒绝读取角色卡时的路径穿越", async () => {
    await expect(mod.tavernStore.readCharacter("../../etc/passwd")).rejects.toThrow();
    // 确认未越权写出到数据根之外
    expect(fileOutsideRoot(path.resolve(TMP, "..", "etc", "pwn.json"))).toBe(false);
  });
});

function fileOutsideRoot(p: string): boolean {
  try {
    rmSync(p, { force: false });
    return true;
  } catch {
    return false;
  }
}
