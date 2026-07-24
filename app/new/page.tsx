"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createProject, hasConfig } from "@/lib/client";

export default function NewBookPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [configReady, setConfigReady] = useState(true);

  useEffect(() => {
    setConfigReady(hasConfig());
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const p = await createProject(title.trim() || "未命名作品");
    router.push(`/project/${p.id}`);
  }

  return (
    <>
      <main className="shell" style={{ paddingTop: 60, paddingBottom: 90 }}>
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <div className="fadeup" style={{ textAlign: "center", marginBottom: 26 }}>
            <div className="seal" style={{ margin: "0 auto 16px", width: 52, height: 52, fontSize: 26 }}>
              书
            </div>
            <h1 style={{ fontSize: 32, marginBottom: 10 }}>开一本新书</h1>
            <p className="muted" style={{ fontSize: 15 }}>
              先起个名字就好，别的都可以进去慢慢想。名字不满意，之后也能随时改。
            </p>
          </div>

          {!configReady && (
            <div
              className="panel"
              style={{
                padding: "14px 18px",
                display: "flex",
                alignItems: "center",
                gap: 14,
                marginBottom: 18,
                borderColor: "rgba(197,106,63,.4)",
              }}
            >
              <span className="dot dot--draft" />
              <span className="muted" style={{ flex: 1 }}>
                还没接上模型接口，进去后大纲生成会用不了。
              </span>
              <Link href="/settings" className="btn btn--ghost btn--sm">
                去设置
              </Link>
            </div>
          )}

          <form onSubmit={handleCreate} className="panel" style={{ padding: 26 }}>
            <div className="field" style={{ marginBottom: 18 }}>
              <label className="label" htmlFor="title">
                给这本书起个名
              </label>
              <input
                id="title"
                className="input"
                placeholder="例如：《山海拾遗录》"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={40}
                autoFocus
              />
              <span className="hint">留空也行，会先叫「未命名作品」。</span>
            </div>
            <button
              type="submit"
              className="btn btn--primary"
              style={{ width: "100%" }}
              disabled={creating}
            >
              {creating ? "正在铺纸…" : "落笔，进入工作台 →"}
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: 20 }}>
            <Link href="/shelf" className="faint" style={{ fontSize: 13 }}>
              或者，先回书架看看在写的书 →
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
