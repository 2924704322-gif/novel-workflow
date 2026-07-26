"use client";

// 加载骨架屏（FT-12 状态规范组件）
// 清爽风令牌：.skeleton 取琥珀微光（状态语义 .skeleton=amber，对应草稿·进行中/加载中）。
// 用法：<Skeleton height={14} style={{ maxWidth: 200 }} /> —— 直接铺在占位处。

import type { CSSProperties } from "react";

interface SkeletonProps {
  /** 宽度，默认 100%。 */
  width?: string | number;
  /** 高度，默认 12。 */
  height?: string | number;
  /** 圆角，默认 6。 */
  radius?: string | number;
  className?: string;
  style?: CSSProperties;
}

export default function Skeleton({
  width = "100%",
  height = 12,
  radius = 6,
  className = "",
  style,
}: SkeletonProps) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}
