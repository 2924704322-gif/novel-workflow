// 确认写入落稿的纯逻辑层（FT-09，从 React 状态机抽离以便单测）
//
// 职责分界（与 runtime 写入 / UI 落稿）：
//   - runtime（/api/agent/chat 或 mock 流）经 useChat.confirm 收到 ConfirmToken 后，
//     负责「程序化写数据」；本文件是**客户端落稿闭环**的数据面：
//       · resolveChapter：按 targetChapterId(Q12) 定位卷/章，无 id 时按 fileName 模糊兜底；
//       · applyMdDraftToStorage：章节类 → ProjectRepository.applyChapterContent；
//         设定类 → docsStore.save + syncDocsToBible（回填 bible 缓存，单向）。
//   - StudioProvider.confirmMd 调用本层完成落盘，再做 UI 状态切换（切分段 / 收起等）。
//
// 依赖默认指向真实单例；测试可注入 fake（deps）以隔离验证数据流。

import { projectRepository, LOCAL_OWNER, type ProjectRepository } from "./repository";
import { docsStore, type DocsStore } from "./docsStore";
import { syncDocsToBible } from "./migrate";
import type { Project } from "./types";
import type { MdDraft } from "./agent/types";

/** 章节定位结果。 */
export interface ChapterLoc {
  volId: string;
  chId: string;
}

/**
 * 定位提案 draft 对应的卷/章。
 * 1) 优先用 draft.targetChapterId（Q12，Agent 显式产出）精确命中；
 * 2) 未命中或缺失时，按 fileName 解析「第N章」序号 / 标题子串模糊匹配，
 *    仅在有正向信号（score>0）时采纳（P2-3：拒绝零分兜底，防止把
 *    无关草稿静默覆盖到首章正文）；
 * 3) 全书仅有一章时唯一落点无歧义，仍允许兜底；否则返回 null，
 *    由上层报错提示用户显式指定目标章节。
 */
export function resolveChapter(project: Project, draft: MdDraft): ChapterLoc | null {
  // 1) 显式 targetChapterId
  if (draft.targetChapterId) {
    for (const v of project.volumes) {
      for (const c of v.chapters) {
        if (c.id === draft.targetChapterId) {
          return { volId: v.id, chId: c.id };
        }
      }
    }
    console.warn(
      `[resolveChapter] targetChapterId=${draft.targetChapterId} 未命中，进入模糊兜底`
    );
  }

  // 2) 模糊兜底：第N章序号 + 标题子串（P2-3：零分不采纳）
  const name = (draft.fileName || "").replace(/\.md$/i, "");
  const idxMatch = /第\s*(\d+)\s*章/.exec(name);
  const idx = idxMatch ? Number(idxMatch[1]) : null;
  let best: ChapterLoc | null = null;
  let bestScore = 0;
  for (const v of project.volumes) {
    for (const c of v.chapters) {
      let score = 0;
      if (idx !== null && c.index === idx) score += 10;
      if (c.title && name.includes(c.title)) score += 5;
      if (c.title && c.title.includes(name)) score += 3;
      if (score > bestScore) {
        bestScore = score;
        best = { volId: v.id, chId: c.id };
      }
    }
  }
  if (best) {
    console.warn(`[resolveChapter] 模糊兜底命中 chapter=${best.chId}（score=${bestScore}）`);
    return best;
  }

  // 3) 无任何信号：仅当全书只有一章（落点无歧义）才兜底，否则拒绝。
  const allChapters = project.volumes.flatMap((v) =>
    v.chapters.map((c) => ({ volId: v.id, chId: c.id }))
  );
  if (allChapters.length === 1) return allChapters[0];
  return null;
}

/** 可注入依赖（测试用 fake，默认用真实单例）。 */
export interface StudioActionDeps {
  repo: ProjectRepository;
  docs: DocsStore;
  syncBible: (project: Project, draft: MdDraft) => Promise<void>;
}

export const defaultDeps: StudioActionDeps = {
  repo: projectRepository,
  docs: docsStore,
  syncBible: syncDocsToBible,
};

export interface ApplyResult {
  volId?: string;
  chId?: string;
  fileName?: string;
}

/**
 * 把一份 .md 提案落盘（确认写入闭环的数据面）。
 * - 章节类：resolveChapter → applyChapterContent（原子改 chapter.content）。
 * - 设定类：docsStore.save → syncDocsToBible 回填 bible → 存盘 project。
 * 返回定位结果供 UI 切换分段。
 */
export async function applyMdDraftToStorage(
  projectId: string,
  draft: MdDraft,
  deps: StudioActionDeps = defaultDeps
): Promise<ApplyResult> {
  if (draft.kind === "chapter") {
    const project = await deps.repo.get(LOCAL_OWNER, projectId);
    if (!project) throw new Error(`project not found: ${projectId}`);
    const loc = resolveChapter(project, draft);
    if (!loc) throw new Error(`cannot resolve chapter for draft ${draft.fileName}`);
    await deps.repo.applyChapterContent(
      LOCAL_OWNER,
      projectId,
      loc.volId,
      loc.chId,
      draft.body
    );
    return { volId: loc.volId, chId: loc.chId };
  }

  // 设定类
  const kind = draft.settingKind ?? "other";
  await deps.docs.save(projectId, draft.fileName, draft.body, kind);
  const project = await deps.repo.get(LOCAL_OWNER, projectId);
  if (project) {
    await deps.syncBible(project, draft);
    await deps.repo.save(LOCAL_OWNER, project);
  }
  return { fileName: draft.fileName };
}
