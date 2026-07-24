"use client";

import Link from "next/link";
import ProfileSwitcher from "@/components/ProfileSwitcher";

/**
 * 全宽应用顶栏（由 AppShell 全局渲染一次）。
 * 导航已移入左侧资源栏，顶栏只保留：侧栏开关(left) · 品牌 · 页面槽(right) · 模型档切换。
 */
export default function TopBar({
  left,
  right,
}: {
  left?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        {left}
        <Link href="/" className="brand" aria-label="回到暖阁首页">
          <span className="seal">暖</span>
          <span style={{ display: "grid", lineHeight: 1.15 }}>
            <span className="brand-name">暖阁</span>
            <span className="brand-sub">cozy atelier</span>
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
          {right}
          <ProfileSwitcher />
        </div>
      </div>
    </header>
  );
}
