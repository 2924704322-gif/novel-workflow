"use client";

// HITL 可编辑 .md 提案卡（FT-06 / Q12）
// 渲染 ChangeProposal.md（MdDraft）：文件名标题 + 类型 + 可编辑 textarea + 确认/取消/重新生成。
// 「确认写入」→ 透传编辑后 body 给 useChat.confirm(id, true, body)（回传 ConfirmToken，runtime 幂等 apply 一次）。
// 「取消」→ useChat.confirm(id, false)；「重新生成」→ 重新生成指令（useChat.send）。
// targetChapterId 透传（落稿定位留 FT-09）。

import { useState } from "react";
import { FileText, RefreshCw } from "./icons";
import type { ChangeProposal, MdDraft } from "@/lib/agent/types";

const KIND_LABEL: Record<MdDraft["kind"], string> = {
  chapter: "章节正文",
  setting: "设定文档",
};

const SETTING_LABEL: Record<string, string> = {
  world: "世界观",
  character: "人物设定",
  outline: "大纲",
  inspiration: "灵感",
  other: "其他设定",
};

export default function HitlMdCard({
  proposal,
  disabled,
  onConfirm,
  onCancel,
  onRegenerate,
}: {
  proposal: ChangeProposal;
  disabled?: boolean;
  onConfirm: (editedBody: string) => void;
  onCancel: () => void;
  onRegenerate?: () => void;
}) {
  const md = proposal.md as MdDraft;
  const [body, setBody] = useState<string>(md.body);
  const [preview, setPreview] = useState(false);

  const settingTag =
    md.kind === "setting" && md.settingKind ? SETTING_LABEL[md.settingKind] ?? "设定" : null;

  return (
    <div className="hitl" aria-label="可编辑 .md 提案">
      <div className="hitl-head">
        <FileText size={15} />
        <strong>{md.fileName}</strong>
        <span className="chip chip--cinnabar">{KIND_LABEL[md.kind]}</span>
        {settingTag && <span className="chip">{settingTag}</span>}
        {md.targetChapterId && <span className="chip">章 id · {md.targetChapterId}</span>}
        <span className="chip">待确认改动</span>
      </div>

      <div className="hitl-body">
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {proposal.changeSummary}
        </p>

        {preview ? (
          <pre className="md-preview">{body}</pre>
        ) : (
          <textarea
            className="md-editor"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={disabled}
            spellCheck={false}
            aria-label="编辑 .md 内容"
          />
        )}

        <div className="hitl-actions">
          <button className="btn-primary" disabled={disabled} onClick={() => onConfirm(body)}>
            确认写入
          </button>
          <button className="btn-ghost" disabled={disabled} onClick={onCancel}>
            取消
          </button>
          <button className="btn-ghost" disabled={disabled} onClick={() => setPreview((v) => !v)}>
            {preview ? "编辑" : "预览"}
          </button>
          {onRegenerate && (
            <button
              className="btn-ghost"
              disabled={disabled}
              onClick={onRegenerate}
              title="重新生成"
            >
              <RefreshCw size={14} /> 重新生成
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
