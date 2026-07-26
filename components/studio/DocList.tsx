"use client";

// .md 文档列表（FT-08 / Q6 大纲·设定落点）
// 来自 docsStore.list；点击某文档 → onPick(name) 触发右栏「文档」分段切换到阅读器。

import type { DocMeta } from "@/lib/docsStore";

export default function DocList({
  docs,
  activeName,
  onPick,
}: {
  docs: DocMeta[];
  activeName?: string | null;
  onPick: (name: string) => void;
}) {
  if (!docs.length) {
    return (
      <div className="doc-list">
        <p className="faint">
          还没有文档。确认写入设定类 .md（世界观 / 人物设定 / 大纲）后会落在这里。
        </p>
      </div>
    );
  }

  return (
    <div className="doc-list">
      {docs.map((d) => (
        <button
          key={d.name}
          type="button"
          className={"doc-card" + (d.name === activeName ? " on" : "")}
          onClick={() => onPick(d.name)}
        >
          <div className="doc-card-top">
            <span className="doc-name">{d.name}</span>
            <span className="chip">{d.kindLabel}</span>
          </div>
          <span className="doc-meta">{d.words} 字</span>
        </button>
      ))}
    </div>
  );
}
