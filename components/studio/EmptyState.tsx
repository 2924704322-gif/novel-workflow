"use client";

// 空状态组件（FT-12 状态规范组件）
// 清爽风令牌：图标底色用 --surface-2，标题用 --fg，提示用 --fg-faint。
// 用法：<EmptyState icon={<Clock size={20} />} title="暂无数据" hint="..." action={<按钮/>} />

import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({
  icon,
  title,
  hint,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`empty-state ${className}`.trim()}>
      {icon && (
        <div className="empty-ico" aria-hidden="true">
          {icon}
        </div>
      )}
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}
