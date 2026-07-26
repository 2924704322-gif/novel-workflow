"use client";

// 全宽应用顶栏（FT-03 改造）
// - 品牌字「暖阁」→「Novel&Chat」（终稿 §7 品牌决策）
// - 高度 52px（清爽风令牌）
// - 工作室模式下：左侧导航收起开关 + 右侧「新对话」按钮（reset 中栏对话，
//   本批先接占位，FT-05 填充 chat 后生效）+ 右栏收起开关。
// 兼容旧调用：不传 onToggleLeft/onToggleRight 时退化为纯品牌栏
// （如 /agent 开发预览页）。

import Link from "next/link";
import ProfileSwitcher from "@/components/ProfileSwitcher";
import {
  PanelLeft,
  MessageSquarePlus,
  PanelRight,
  PanelRightClose,
} from "./studio/icons";

interface TopBarProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
  leftCollapsed?: boolean;
  onToggleLeft?: () => void;
  onNewChat?: () => void;
  rightOpen?: boolean;
  onToggleRight?: () => void;
}

export default function TopBar({
  left,
  right,
  leftCollapsed,
  onToggleLeft,
  onNewChat,
  rightOpen,
  onToggleRight,
}: TopBarProps) {
  const studioMode = Boolean(onToggleLeft || onToggleRight);

  return (
    <header className="topbar">
      {left}
      {studioMode && (
        <button
          className="btn btn--ghost btn--sm"
          onClick={onToggleLeft}
          title={leftCollapsed ? "展开导航" : "收起导航"}
          aria-label="切换导航"
        >
          <PanelLeft size={16} />
        </button>
      )}
      <Link href="/" className="brand" aria-label="回到 Novel&Chat 首页">
        <img src="/logo.svg" alt="" className="brand-logo" width={28} height={28} />
        <span style={{ display: "grid", lineHeight: 1.15 }}>
          <span className="brand-name">Novel&amp;Chat</span>
          <span className="brand-sub">novel &amp; chat</span>
        </span>
      </Link>
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          gap: 10,
          alignItems: "center",
        }}
      >
        {studioMode && (
          <>
            <button
              className="btn btn--primary btn--sm"
              onClick={onNewChat}
              title="开启一段新对话"
            >
              <MessageSquarePlus size={16} />
              新对话
            </button>
            {onToggleRight && (
              <button
                className="btn btn--ghost btn--sm"
                onClick={onToggleRight}
                title={rightOpen ? "收起右栏" : "展开右栏"}
                aria-label="切换右栏"
              >
                {rightOpen ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
              </button>
            )}
          </>
        )}
        {right}
        <ProfileSwitcher />
      </div>
    </header>
  );
}
