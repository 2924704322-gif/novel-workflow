// A 组工具：数据 / 项目（映射 lib/storage 经 Repository）。从原 lib/agent/tools.ts 搬来，逻辑未改。

import type { Chapter, Project } from "../types";
import { emptyProject, toSummary } from "../types";
import { projectRepository } from "../repository";
import {
  type AgentTool,
  type ToolArgs,
  type ToolContext,
  foldGenerated,
  loadProject,
  projectIdParam,
  rid,
} from "./tools-shared";

const list_projects: AgentTool = {
  name: "list_projects",
  description: "列出全部作品的摘要（标题、阶段、字数、章节进度）。",
  group: "A",
  write: false,
  parameters: { type: "object", properties: {} },
  run: async (_args, ctx) =>
    (await projectRepository.list(ctx.ownerId)).map(toSummary),
};

const get_project: AgentTool = {
  name: "get_project",
  description: "读取整本作品（含设定集、分卷、章节、设定库、伏笔等）。",
  group: "A",
  write: false,
  parameters: { type: "object", properties: { ...projectIdParam } },
  run: async (args, ctx) => loadProject(ctx, args.projectId),
};

const create_project: AgentTool = {
  name: "create_project",
  description: "新建一本空作品。写操作，需用户确认。",
  group: "A",
  write: true,
  parameters: {
    type: "object",
    properties: { title: { type: "string", description: "作品标题" } },
    required: ["title"],
  },
  propose: async (args) => {
    // 提案时即预分配作品 id，随 argsPatch 固化进 proposal.args；apply 复用它，
    // 确保「确认一次 = 落库一次」：同一份已确认提案即便被重复 apply，也只覆盖
    // 同一 id 而非新建出重复作品。
    const id = rid();
    return {
      changeSummary: `新建空作品「${(args.title as string) || "未命名作品"}」`,
      diff: { id, title: args.title },
      argsPatch: { id },
    };
  },
  apply: async (args, ctx) => {
    const id = (args.id as string)?.trim() || rid();
    const p = emptyProject(id, (args.title as string)?.trim() || "未命名作品");
    return projectRepository.save(ctx.ownerId, p);
  },
};

const save_project: AgentTool = {
  name: "save_project",
  description:
    "把一组字段覆盖保存到作品。持久化 generate_* 的生成候选时，优先用 fromGenerated 列出候选类型（如 ['bible']/['volumes']/['volume']/['chapter']/['recap']），平台会自动把本轮生成结果合并落库——无需把生成的 JSON 复制进 patch。也可直接用 patch 覆盖顶层字段（title/phase/setup/codex/...）。写操作，需用户确认。",
  group: "A",
  write: true,
  parameters: {
    type: "object",
    properties: {
      ...projectIdParam,
      fromGenerated: {
        type: "array",
        items: { type: "string" },
        description:
          "要落库的本轮已生成候选类型：bible/volumes/volume/chapter/chapter_outline/recap。省略且未提供 patch 时，默认落库本轮全部已生成候选。",
      },
      patch: {
        type: "object",
        description:
          "要覆盖写入的顶层字段（Partial<Project>）。仅提供需变更的字段即可。",
      },
    },
  },
  propose: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    const explicit = (args.patch as Partial<Project>) || {};
    const cache = ctx.generated || {};
    let kinds: string[] = Array.isArray(args.fromGenerated)
      ? (args.fromGenerated as string[])
      : [];
    // 未显式指定、且没有手动 patch 时：默认折回本轮全部已生成候选。这正是修复
    // 「模型以空 patch 调用 save_project」的关键——空调用也能正确落库。
    if (kinds.length === 0 && Object.keys(explicit).length === 0) {
      kinds = Object.keys(cache);
    }
    const folded = foldGenerated(p, cache, kinds);
    const finalPatch: Partial<Project> = { ...folded.patch, ...explicit };
    const keys = Array.from(new Set([...folded.keys, ...Object.keys(explicit)]));
    return {
      changeSummary: `保存作品「${p.title}」：更新字段 ${keys.join("、") || "（无）"}`,
      diff: { projectId: p.id, changedKeys: keys },
      argsPatch: { patch: finalPatch },
    };
  },
  apply: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    const patch = (args.patch as Partial<Project>) || {};

    // 版本历史：落库前对被修改的章节拍快照
    if (patch.volumes) {
      const { saveSnapshot } = await import("@/lib/history/store");
      for (let vi = 0; vi < p.volumes.length; vi++) {
        const oldVol = p.volumes[vi];
        const newVol = patch.volumes[vi];
        if (!newVol) continue;
        for (const oldCh of oldVol.chapters) {
          if (!oldCh.content) continue; // 空章节不需要快照
          const newCh = newVol.chapters?.find((c: Chapter) => c.id === oldCh.id);
          if (newCh && newCh.content !== oldCh.content) {
            await saveSnapshot(p.id, oldCh.id, vi, oldCh, "agent");
          }
        }
      }
    }

    const merged: Project = {
      ...p,
      ...patch,
      id: p.id,
      createdAt: p.createdAt,
    };
    return projectRepository.save(ctx.ownerId, merged);
  },
};

const delete_project: AgentTool = {
  name: "delete_project",
  description: "删除一本作品（不可恢复）。高危写操作，需用户确认。",
  group: "A",
  write: true,
  parameters: {
    type: "object",
    properties: { ...projectIdParam },
    required: ["projectId"],
  },
  propose: async (args, ctx) => {
    const p = await loadProject(ctx, args.projectId);
    return {
      changeSummary: `删除作品「${p.title}」（不可恢复）`,
      diff: { projectId: p.id, title: p.title },
    };
  },
  apply: async (args, ctx) => {
    await projectRepository.delete(ctx.ownerId, args.projectId as string);
    return { ok: true };
  },
};

export { list_projects, get_project, create_project, save_project, delete_project };
