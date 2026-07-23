"use client";

import Link from "next/link";
import ProfileSwitcher from "@/components/ProfileSwitcher";

export default function TopBar({
  right,
}: {
  right?: React.ReactNode;
}) {
  return (
    <header className="topbar">
      <div className="shell topbar-inner">
        <Link href="/" className="brand" aria-label="回到暖阁首页">
          <span className="seal">暖</span>
          <span style={{ display: "grid", lineHeight: 1.15 }}>
            <span className="brand-name">暖阁</span>
            <span className="brand-sub">cozy atelier</span>
          </span>
        </Link>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          {right}
          <ProfileSwitcher />
          <Link href="/shelf" className="btn btn--ghost btn--sm">
            我的书架
          </Link>
          <Link href="/style" className="btn btn--ghost btn--sm">
            拆书工坊
          </Link>
          <Link href="/continue" className="btn btn--ghost btn--sm">
            续写
          </Link>
          <Link href="/settings" className="btn btn--ghost btn--sm">
            接口设置
          </Link>
        </div>
      </div>
    </header>
  );
}
