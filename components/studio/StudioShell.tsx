"use client";

// 新三栏外壳（FT-03）
//
// 布局：topbar(52px) + 横向三栏（左 248/56 · 中 flex:1 · 右 380/0）。
// 左/右收起语义：收起后中栏 flex:1 自动吃满（修旧版留白）。
// 深链兼容（Q7）：挂载时若 URL 带 ?book=<id>，自动 openBook 打开该书详情。

import { useEffect, useState } from "react";
import TopBar from "@/components/TopBar";
import LeftNav from "./LeftNav";
import RightDock from "./RightDock";
import ChatStudio from "./ChatStudio";
import RoleplayChat from "@/components/RoleplayChat";
import { useStudio } from "./StudioProvider";

export default function StudioShell() {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const {
    rightMode,
    toggleRight,
    chat,
    openBook,
    selectedBookId,
    roleplayActive,
    roleplayTarget,
    exitRoleplay,
  } = useStudio();

  // Q7 深链兼容：/project/[id] 重定向到 /?book=<id> 后，由此处打开该书详情。
  useEffect(() => {
    const book = new URLSearchParams(window.location.search).get("book");
    if (book) openBook(book);
  }, [openBook]);

  const rightClosed = rightMode === "closed";

  // 中栏 key：roleplay 目标（含 picker 态）变化即整体重挂载，保证选角/群组切换干净。
  const roleplayKey = roleplayTarget
    ? `rp-${roleplayTarget.kind}:${
        roleplayTarget.kind === "character"
          ? roleplayTarget.codexId
          : roleplayTarget.groupId
      }`
    : "rp-picker";

  return (
    <div className="app">
      <TopBar
        leftCollapsed={leftCollapsed}
        onToggleLeft={() => setLeftCollapsed((c) => !c)}
        onNewChat={() => chat?.reset()}
        rightOpen={!rightClosed}
        onToggleRight={toggleRight}
      />
      <div className="app-body">
        <aside className={"left" + (leftCollapsed ? " collapsed" : "")}>
          <LeftNav
            collapsed={leftCollapsed}
            onToggleCollapse={() => setLeftCollapsed((c) => !c)}
          />
        </aside>
        <main className="center">
          {roleplayActive ? (
            <RoleplayChat
              key={roleplayKey}
              projectId={selectedBookId ?? ""}
              target={roleplayTarget}
              onExit={exitRoleplay}
            />
          ) : (
            <ChatStudio />
          )}
        </main>
        <aside className={"right" + (rightClosed ? " collapsed" : "")}>
          <RightDock />
        </aside>
      </div>
    </div>
  );
}
