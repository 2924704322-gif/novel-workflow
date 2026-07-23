"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import TopBar from "@/components/TopBar";
import {
  fetchProjects,
  deleteProjectRemote,
  formatWords,
} from "@/lib/client";
import type { ProjectSummary } from "@/lib/types";

const PHASE_LABEL: Record<ProjectSummary["phase"], string> = {
  setup: "还在酝酿",
  outline: "正在搭骨架",
  writing: "正在写",
};

const PHASE_CHIP: Record<ProjectSummary["phase"], string> = {
  setup: "chip",
  outline: "chip chip--jade",
  writing: "chip chip--cinnabar",
};

function fromNow(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

export default function ShelfPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  useEffect(() => {
    fetchProjects().then(setProjects);
  }, []);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`确定把《${name}》从书架上拿走吗？这一步没法撤销。`)) return;
    await deleteProjectRemote(id);
    setProjects((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
  }

  return (
    <>
      <TopBar />

      <main className="shell" style={{ paddingTop: 60, paddingBottom: 90 }}>
        {/* Header */}
        <div
          className="fadeup"
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 20,
            marginBottom: 28,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 style={{ fontSize: 32, marginBottom: 8 }}>我的书架</h1>
            <p className="muted" style={{ fontSize: 15 }}>
              {projects === null
                ? "正在把书一本本搬上来…"
                : projects.length > 0
                ? `架上摆着 ${projects.length} 本书，挑一本接着写吧。`
                : "书架还空着，先去开一本新书吧。"}
            </p>
          </div>
          <Link href="/new" className="btn btn--primary">
            + 开一本新书
          </Link>
        </div>

        {/* Empty state */}
        {projects !== null && projects.length === 0 && (
          <div
            className="panel fadeup"
            style={{
              padding: "56px 24px",
              textAlign: "center",
            }}
          >
            <div
              className="seal"
              style={{
                margin: "0 auto 18px",
                width: 52,
                height: 52,
                fontSize: 26,
              }}
            >
              架
            </div>
            <h3 style={{ fontSize: 20, marginBottom: 10 }}>这里还空空的</h3>
            <p
              className="muted"
              style={{ fontSize: 14, maxWidth: 400, margin: "0 auto 22px" }}
            >
              每一本大部头都是从一个书名开始的。泡杯茶，我们从第一页写起。
            </p>
            <Link href="/new" className="btn btn--primary">
              动手写第一本 →
            </Link>
          </div>
        )}

        {/* Work list */}
        {projects && projects.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 18,
            }}
          >
            {projects.map((p, i) => (
              <div
                key={p.id}
                className="panel work-card fadeup"
                style={{ padding: 20, animationDelay: `${i * 50}ms` }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 12,
                  }}
                >
                  <span className={PHASE_CHIP[p.phase]}>
                    {PHASE_LABEL[p.phase]}
                  </span>
                  <button
                    className="btn btn--ghost btn--sm btn--danger"
                    onClick={() => handleDelete(p.id, p.title)}
                    aria-label={`删除《${p.title}》`}
                  >
                    移走
                  </button>
                </div>

                <Link href={`/project/${p.id}`} style={{ display: "block" }}>
                  <h3
                    style={{
                      fontSize: 19,
                      marginBottom: 6,
                      color: "var(--fg)",
                    }}
                  >
                    {p.title}
                  </h3>
                  <p
                    className="faint"
                    style={{ fontSize: 12.5, marginBottom: 16 }}
                  >
                    {p.genre || "还没定题材"} · {fromNow(p.updatedAt)}
                  </p>

                  <div
                    style={{
                      display: "flex",
                      gap: 18,
                      fontSize: 13,
                      color: "var(--fg-dim)",
                    }}
                  >
                    <span>{formatWords(p.totalWords)}</span>
                    <span>
                      {p.doneCount}/{p.chapterCount} 章
                    </span>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
