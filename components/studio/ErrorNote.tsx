"use client";

// 统一错误条（FT-12 状态规范组件）
// 清爽风令牌：边框/底色用 --danger 浅色（状态语义 danger=错误）。
// 用法：<ErrorNote>读取失败：{msg}</ErrorNote>

import type { ReactNode } from "react";

interface ErrorNoteProps {
  children: ReactNode;
  className?: string;
}

export default function ErrorNote({
  children,
  className = "",
}: ErrorNoteProps) {
  return (
    <div className={`err-note ${className}`.trim()} role="alert">
      <span className="err-note-ico" aria-hidden="true">
        !
      </span>
      <div className="err-note-body">{children}</div>
    </div>
  );
}
