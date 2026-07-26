"use client";

// Markdown 文档阅读器（FT-08 / Q8）
//
// P2-11：react-markdown + remark-gfm 已安装接入（社区标准渲染栈，无 XSS 风险，
// 默认不渲染原始 HTML）。lib/markdown.ts 保留作为离线环境兜底实现，不再在此使用。

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DocRecord } from "@/lib/docsStore";

export default function DocReader({ record }: { record: DocRecord | null }) {
  if (!record) {
    return (
      <div className="doc-reader">
        <p className="faint">选择左侧文档查看内容</p>
      </div>
    );
  }

  return (
    <div className="doc-reader">
      <div className="doc-reader-head">
        <span className="doc-name">{record.name}</span>
        <span className="chip">{record.kindLabel}</span>
      </div>
      <div className="md-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{record.body}</ReactMarkdown>
      </div>
    </div>
  );
}
