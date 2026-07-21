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
        <Link href="/" className="brand" aria-label="返回作品库">
          <span className="seal">墨</span>
          <span style={{ display: "grid", lineHeight: 1.15 }}>
            <span className="brand-name">墨章</span>
            <span className="brand-sub">novel atelier</span>
          </span>
        </Link>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          {right}
          <ProfileSwitcher />
          <Link href="/settings" className="btn btn--ghost btn--sm">
            接口设置
          </Link>
        </div>
      </div>
    </header>
  );
}
