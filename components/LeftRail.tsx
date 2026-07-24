"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchProjects, formatWords } from "@/lib/client";
import type { ProjectSummary } from "@/lib/types";

/**
 * 左侧资源栏（IDE 式）：上半为全局导航，下半为「书库」列表。
 * 导航项与书目均按当前路由高亮；点击书目直接进入对应作品工作区。
 * 章节树仍留在作品工作区内部（依赖已加载的整本数据），此处只到「书」这一层。
 */
const NAV = [
  { href: "/", label: "书房首页", seal: "阁" },
  { href: "/new", label: "开一本新书", seal: "书" },
  { href: "/continue", label: "续写", seal: "续" },
  { href: "/style", label: "拆书工坊", seal: "拆" },
  { href: "/settings", label: "接口设置", seal: "设" },
];

const PHASE_DOT: Record<ProjectSummary["phase"], string> = {
  setup: "dot",
  outline: "dot dot--draft",
  writing: "dot dot--done",
};

export default function LeftRail({ onCollapse }: { onCollapse: () => void }) {
  const pathname = usePathname();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  // 路由变化时刷新书库（新建/删除作品后能及时反映）。
  useEffect(() => {
    let alive = true;
    fetchProjects()
      .then((ps) => alive && setProjects(ps))
      .catch(() => alive && setProjects([]));
    return () => {
      alive = false;
    };
  }, [pathname]);

  function navActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <div className="rail-inner">
      <div className="rail-head">
        <span className="rail-head-title">工作台</span>
        <button
          className="btn btn--ghost btn--sm"
          onClick={onCollapse}
          title="收起侧栏"
          aria-label="收起侧栏"
        >
          ‹
        </button>
      </div>

      <nav className="rail-scroll scroll-y">
        <div className="rail-group-label">导航</div>
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={navActive(n.href) ? "rail-item rail-item--on" : "rail-item"}
          >
            <span className="seal seal--sm" aria-hidden style={{ flex: "0 0 auto" }}>
              {n.seal}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>{n.label}</span>
          </Link>
        ))}

        <div className="rail-group-label" style={{ marginTop: 8 }}>
          书库
          {projects && projects.length > 0 && (
            <span className="faint" style={{ marginLeft: 6 }}>
              {projects.length}
            </span>
          )}
        </div>

        {projects === null ? (
          <p className="faint rail-hint">正在整理书架…</p>
        ) : projects.length === 0 ? (
          <p className="faint rail-hint">
            书架还空着，
            <Link href="/new" className="rail-inline-link">
              开一本新书
            </Link>
            吧。
          </p>
        ) : (
          projects.map((p) => {
            const active = pathname === `/project/${p.id}`;
            return (
              <Link
                key={p.id}
                href={`/project/${p.id}`}
                className={active ? "rail-book rail-book--on" : "rail-book"}
              >
                <span className={PHASE_DOT[p.phase]} aria-hidden />
                <span className="rail-book-main">
                  <span className="rail-book-title">{p.title}</span>
                  <span className="rail-book-meta faint">
                    {formatWords(p.totalWords)} · {p.doneCount}/{p.chapterCount} 章
                  </span>
                </span>
              </Link>
            );
          })
        )}
      </nav>
    </div>
  );
}
