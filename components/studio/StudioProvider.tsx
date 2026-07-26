"use client";

// 工作室共享状态（FT-04，契约见终稿 §3.5 合并类图）
//
// 通过 React Context 向整棵 Studio 子树（StudioShell / LeftNav / RightDock /
// ChatStudio / BookDetail / TavernDetail）下发选书状态与右栏模式。
// 本批（FT-08/09/10）落地：confirmMd 真实落稿闭环、openDoc 文档分段入口、
// 以及驱动 BookDetail 刷新/选章的 projectVersion / readerChapterId / openDocName 状态。

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { UseChat } from "@/lib/agent/useChat";
import type { MdDraft } from "@/lib/agent/types";
import { confirmMdRemote } from "@/lib/client";

export type RightMode = "closed" | "book" | "tavern";
export type StudioPage = "book" | "tavern";
export type StudioSeg = "result" | "reader" | "doc";

/** 中栏沉浸式酒馆对话的目标（FT-21）：单角色卡 或 单群组。 */
export type RoleplayTarget =
  | { kind: "character"; codexId: string }
  | { kind: "group"; groupId: string };

export interface StudioProviderValue {
  selectedBookId: string | null;
  rightMode: RightMode;
  rightSeg: Record<StudioPage, StudioSeg>;
  /** 当前在「文档」分段打开的 .md 名（null = 仅列表）。 */
  openDocName: string | null;
  /** 「阅读」分段要展示的章节 id（confirmMd 落稿后定位）。 */
  readerChapterId: string | null;
  /** 落稿 / 迁移后自增，驱动 BookDetail 重新读盘与文档列表刷新。 */
  projectVersion: number;
  /** confirmMd 落稿失败时的用户可见错误（P2-8）；下次落稿前自动清空。 */
  confirmError: string | null;
  /** FT-05 填充：中栏对话状态机。 */
  chat: UseChat | null;
  /** FT-21：中栏是否处于沉浸式酒馆对话（角色/群组）模式。 */
  roleplayActive: boolean;
  /** FT-21：当前酒馆对话目标；null = 仍处于「选角/选群组」picker 态。 */
  roleplayTarget: RoleplayTarget | null;
  openBook(id: string): void;
  openTavern(): void;
  toggleRight(): void;
  switchSeg(page: StudioPage, seg: StudioSeg): void;
  /** 打开某文档：切到「文档」分段并定位阅读器。 */
  openDoc(name: string): void;
  /** FT-09 确认写入闭环节点：落盘 + 切分段 + 刷新。 */
  confirmMd(draft: MdDraft): Promise<void>;
  /** 把 useChat 实例注册进来，供「新对话」等动作调用。 */
  setChat(chat: UseChat | null): void;
  /** FT-21：直接进入指定目标的酒馆对话（角色/群组）。 */
  startRoleplay(target: RoleplayTarget): void;
  /** FT-21：打开酒馆对话 picker（目标未定，由用户在 RoleplayChat 内选择）。 */
  openRoleplayPicker(): void;
  /** FT-21：退出沉浸式酒馆对话，中栏回到创作工作台（ChatStudio）。 */
  exitRoleplay(): void;
}

const StudioCtx = createContext<StudioProviderValue | null>(null);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [rightMode, setRightMode] = useState<RightMode>("closed");
  const [rightSeg, setRightSeg] = useState<Record<StudioPage, StudioSeg>>({
    book: "result",
    tavern: "result",
  });
  const [openDocName, setOpenDocName] = useState<string | null>(null);
  const [readerChapterId, setReaderChapterId] = useState<string | null>(null);
  const [projectVersion, setProjectVersion] = useState(0);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [chat, setChat] = useState<UseChat | null>(null);
  // FT-21：中栏沉浸式酒馆对话模式状态。
  const [roleplayActive, setRoleplayActive] = useState(false);
  const [roleplayTarget, setRoleplayTarget] = useState<RoleplayTarget | null>(null);

  const openBook = useCallback((id: string) => {
    setSelectedBookId(id);
    setRightMode("book");
    setOpenDocName(null);
    setReaderChapterId(null);
  }, []);

  const openTavern = useCallback(() => {
    setRightMode("tavern");
  }, []);

  const toggleRight = useCallback(() => {
    setRightMode((m) => (m === "closed" ? "book" : "closed"));
  }, []);

  // FT-21：直接进入指定目标（角色/群组）的沉浸式酒馆对话。
  const startRoleplay = useCallback((target: RoleplayTarget) => {
    setRoleplayTarget(target);
    setRoleplayActive(true);
  }, []);

  // FT-21：打开 picker 态（目标未定），由 RoleplayChat 内的选角/选群组 UI 决定。
  const openRoleplayPicker = useCallback(() => {
    setRoleplayTarget(null);
    setRoleplayActive(true);
  }, []);

  // FT-21：退出沉浸式酒馆对话，中栏回到创作工作台。
  const exitRoleplay = useCallback(() => {
    setRoleplayActive(false);
    setRoleplayTarget(null);
  }, []);

  const switchSeg = useCallback((page: StudioPage, seg: StudioSeg) => {
    setRightSeg((s) => ({ ...s, [page]: seg }));
  }, []);

  const openDoc = useCallback((name: string) => {
    setOpenDocName(name || null);
    setRightMode("book");
    setRightSeg((s) => ({ ...s, book: "doc" }));
  }, []);

  // FT-09 确认写入闭环节点（数据面下沉到 /api/studio/confirm-md，P0-1 修复：
  // client 不再直连基于 Node fs 的 studioActions，改经 lib/client.confirmMdRemote）：
  //   - 章节类 → applyChapterContent 落盘 → 切「阅读」并定位章节；
  //   - 设定类 → docsStore.save + syncDocsToBible → 切「文档」并打开该 .md；
  //   - 落稿后右栏保持打开并切到对应分段展示成果（终稿 §4.1「右栏展示（阅读/文档）」）；
  //     FT-09 提到的「收起让位中栏」为可选，本批以 §4.1 为准（落稿即时可见），
  //     如需让位中栏可改为 setRightMode("closed")。
  //   - 失败时置 confirmError（P2-8：ChatStudio 渲染错误条，不再只打 console）。
  const confirmMd = useCallback(
    async (draft: MdDraft) => {
      const projectId = selectedBookId;
      if (!projectId) {
        setConfirmError("未选中书籍，落稿已取消——请先在左栏选择一本书。");
        return;
      }
      setConfirmError(null);
      try {
        const res = await confirmMdRemote(projectId, draft);
        setRightMode("book");
        setProjectVersion((v) => v + 1);
        if (draft.kind === "chapter" && res.chId) {
          setReaderChapterId(res.chId);
          switchSeg("book", "reader");
        } else if (draft.kind === "setting" && res.fileName) {
          openDoc(res.fileName);
        }
      } catch (e) {
        console.error("[confirmMd] 落稿失败", e);
        setConfirmError(e instanceof Error ? e.message : "落稿失败，请重试");
      }
    },
    [selectedBookId, openDoc, switchSeg]
  );

  const value = useMemo<StudioProviderValue>(
    () => ({
      selectedBookId,
      rightMode,
      rightSeg,
      openDocName,
      readerChapterId,
      projectVersion,
      confirmError,
      chat,
      roleplayActive,
      roleplayTarget,
      openBook,
      openTavern,
      toggleRight,
      switchSeg,
      openDoc,
      confirmMd,
      setChat,
      startRoleplay,
      openRoleplayPicker,
      exitRoleplay,
    }),
    [
      selectedBookId,
      rightMode,
      rightSeg,
      openDocName,
      readerChapterId,
      projectVersion,
      confirmError,
      chat,
      roleplayActive,
      roleplayTarget,
      openBook,
      openTavern,
      toggleRight,
      switchSeg,
      openDoc,
      confirmMd,
      startRoleplay,
      openRoleplayPicker,
      exitRoleplay,
    ]
  );

  return <StudioCtx.Provider value={value}>{children}</StudioCtx.Provider>;
}

export function useStudio(): StudioProviderValue {
  const ctx = useContext(StudioCtx);
  if (!ctx) {
    throw new Error("useStudio 必须在 <StudioProvider> 内使用");
  }
  return ctx;
}

export default StudioProvider;
