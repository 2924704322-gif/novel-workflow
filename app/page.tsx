"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import TopBar from "@/components/TopBar";
import {
  createProject,
  deleteProjectRemote,
  fetchProjects,
  formatWords,
  hasConfig,
} from "@/lib/client";
import type { ProjectSummary } from "@/lib/types";

const PHASE_LABEL: Record<string, string> = {
  setup: "待立意",
  outline: "大纲中",
  writing: "创作中",
};

export default function DashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [configReady, setConfigReady] = useState(true);

  useEffect(() => {
    fetchProjects().then(setProjects);
    setConfigReady(hasConfig());
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const p = await createProject(title.trim() || "未命名作品");
    router.push(`/project/${p.id}`);
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`确定删除《${name}》？此操作无法撤销。`)) return;
    await deleteProjectRemote(id);
    setProjects((prev) => prev?.filter((p) => p.id !== id) ?? null);
  }

  return (
    <>
      <TopBar />

      {/* Hero — a manuscript opening line, the most characteristic thing */}
      <section className="shell" style={{ paddingTop: 72, paddingBottom: 28 }}>
        <div className="fadeup" style={{ maxWidth: 720 }}>
          <div className="chip chip--cinnabar" style={{ marginBottom: 20 }}>
            两步成书 · 大纲先行 · 逐章落墨
          </div>
          <h1 style={{ fontSize: 46, lineHeight: 1.18, marginBottom: 18 }}>
            先立骨，
            <span style={{ color: "var(--cinnabar-bright)" }}>再填肉</span>
            <br />
            让百万字长篇有章可循。
          </h1>
          <p className="muted" style={{ fontSize: 16, maxWidth: 560 }}>
            第一步，梳理一份贯通全局的故事大纲——内核、世界、人物、卷章脉络；
            第二步，依纲逐章成文，前后呼应，稳定推进到百万字。
          </p>
        </div>
      </section>

      {!configReady && (
        <section className="shell" style={{ paddingBottom: 8 }}>
          <div
            className="panel"
            style={{
              padding: "14px 18px",
              display: "flex",
              alignItems: "center",
              gap: 14,
              borderColor: "rgba(193,68,58,.4)",
            }}
          >
            <span className="dot dot--draft" />
            <span className="muted" style={{ flex: 1 }}>
              尚未配置模型接口，生成功能暂不可用。先填入 API 地址、Key 与模型名。
            </span>
            <Link href="/settings" className="btn btn--primary btn--sm">
              前往设置
            </Link>
          </div>
        </section>
      )}

      <main className="shell" style={{ paddingTop: 24, paddingBottom: 80 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "320px 1fr",
            gap: 28,
            alignItems: "start",
          }}
          className="dash-grid"
        >
          {/* New work */}
          <form onSubmit={handleCreate} className="panel" style={{ padding: 22 }}>
            <h3 style={{ fontSize: 18, marginBottom: 4 }}>开一部新书</h3>
            <p className="faint" style={{ fontSize: 13, marginBottom: 16 }}>
              先起个书名，进入工作台后再细化设定。
            </p>
            <div className="field" style={{ marginBottom: 16 }}>
              <label className="label" htmlFor="title">
                书名
              </label>
              <input
                id="title"
                className="input"
                placeholder="例如：《山海拾遗录》"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={40}
              />
            </div>
            <button
              type="submit"
              className="btn btn--primary"
              style={{ width: "100%" }}
              disabled={creating}
            >
              {creating ? "正在创建…" : "创建并进入工作台"}
            </button>
          </form>

          {/* Library */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 14,
              }}
            >
              <h2 style={{ fontSize: 20 }}>我的书房</h2>
              <span className="faint" style={{ fontSize: 13 }}>
                {projects ? `${projects.length} 部作品` : "加载中…"}
              </span>
            </div>

            {projects && projects.length === 0 && (
              <div
                className="panel"
                style={{
                  padding: "48px 24px",
                  textAlign: "center",
                }}
              >
                <p className="muted">书房还空着。从左侧创建你的第一部作品。</p>
              </div>
            )}

            <div style={{ display: "grid", gap: 12 }}>
              {projects?.map((p) => (
                <div
                  key={p.id}
                  className="panel work-card"
                  style={{
                    padding: 18,
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                  }}
                >
                  <Link
                    href={`/project/${p.id}`}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 6,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontSize: 18,
                          fontWeight: 600,
                        }}
                      >
                        {p.title}
                      </span>
                      <span className="chip">{PHASE_LABEL[p.phase]}</span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 16,
                        fontSize: 13,
                      }}
                      className="faint"
                    >
                      <span>{p.genre || "题材未定"}</span>
                      <span>·</span>
                      <span>{formatWords(p.totalWords)}</span>
                      <span>·</span>
                      <span>
                        {p.doneCount}/{p.chapterCount} 章完成
                      </span>
                    </div>
                  </Link>
                  <button
                    className="btn btn--ghost btn--sm btn--danger"
                    onClick={() => handleDelete(p.id, p.title)}
                    aria-label="删除作品"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
