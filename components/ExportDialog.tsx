"use client";

// 导出作品（FT-11 救火：统一清爽风，Q1）
// 仅用清爽风主层令牌（app/globals.css），清除 Tailwind 暗色类与暖阁硬编码暖色。
// 保持原有功能逻辑（格式/范围/选项 + Electron/Web 双通道下载），只替换视觉层与令牌引用。

import { useState } from "react";
import type { ExportFormat } from "@/lib/export/types";
import { X, Download } from "@/components/studio/icons";
import ErrorNote from "@/components/studio/ErrorNote";

interface ExportDialogProps {
  projectId: string;
  projectTitle: string;
  volumeCount: number;
  open: boolean;
  onClose: () => void;
}

export default function ExportDialog({
  projectId,
  projectTitle,
  volumeCount,
  open,
  onClose,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("epub");
  const [scope, setScope] = useState<"full" | "volume">("full");
  const [volumeIndex, setVolumeIndex] = useState(0);
  const [includeOutline, setIncludeOutline] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;

  const handleExport = async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({
        projectId,
        format,
        scope,
        includeOutline: String(includeOutline),
        includeNotes: String(includeNotes),
      });
      if (scope === "volume") {
        params.set("volumeIndex", String(volumeIndex));
      }

      const url = `/api/export?${params.toString()}`;

      // 检测是否在 Electron 环境（有原生保存对话框）
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.saveFile) {
        const res = await fetch(url);
        if (!res.ok) throw new Error("导出失败");
        const arrayBuf = await res.arrayBuffer();
        const ext = format === "epub" ? "epub" : format === "markdown" ? "md" : "txt";
        const defaultName = `${projectTitle}.${ext}`;
        await electronAPI.saveFile(defaultName, new Uint8Array(arrayBuf));
      } else {
        // Web 模式：浏览器下载
        const a = document.createElement("a");
        a.href = url;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "导出失败");
    } finally {
      setLoading(false);
    }
  };

  const formats: { value: ExportFormat; label: string; desc: string }[] = [
    { value: "epub", label: "EPUB", desc: "电子书格式，适合阅读器" },
    { value: "markdown", label: "Markdown", desc: "带格式标记，适合编辑器" },
    { value: "txt", label: "TXT", desc: "纯文本，通用兼容" },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="tray-title">导出作品</span>
          <button
            type="button"
            className="modal-x"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          {/* 格式选择 */}
          <div className="field" style={{ marginBottom: 16 }}>
            <label className="label">导出格式</label>
            <div className="choice-grid">
              {formats.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  className={"choice" + (format === f.value ? " on" : "")}
                  onClick={() => setFormat(f.value)}
                >
                  <div style={{ fontWeight: 600 }}>{f.label}</div>
                  <div className="tray-sub" style={{ marginTop: 4 }}>
                    {f.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 范围 */}
          <div className="field" style={{ marginBottom: 16 }}>
            <label className="label">导出范围</label>
            <div className="export-scope">
              <label className="radio-line">
                <input
                  type="radio"
                  checked={scope === "full"}
                  onChange={() => setScope("full")}
                  style={{ accentColor: "var(--accent)" }}
                />
                全书
              </label>
              <label className="radio-line">
                <input
                  type="radio"
                  checked={scope === "volume"}
                  onChange={() => setScope("volume")}
                  style={{ accentColor: "var(--accent)" }}
                />
                单卷
              </label>
              {scope === "volume" && (
                <select
                  className="control"
                  style={{ width: "auto", marginLeft: 8 }}
                  value={volumeIndex}
                  onChange={(e) => setVolumeIndex(Number(e.target.value))}
                >
                  {Array.from({ length: volumeCount }, (_, i) => (
                    <option key={i} value={i}>
                      第{i + 1}卷
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* 选项 */}
          <div className="field" style={{ marginBottom: 16 }}>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={includeOutline}
                onChange={(e) => setIncludeOutline(e.target.checked)}
                style={{ accentColor: "var(--accent)" }}
              />
              包含故事设定
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={includeNotes}
                onChange={(e) => setIncludeNotes(e.target.checked)}
                style={{ accentColor: "var(--accent)" }}
              />
              包含章节概要
            </label>
          </div>

          {err && (
            <div style={{ marginBottom: 12 }}>
              <ErrorNote>{err}</ErrorNote>
            </div>
          )}

          <div className="modal-foot">
            <button type="button" className="btn-ghost" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleExport}
              disabled={loading}
            >
              <Download size={15} />
              {loading ? "导出中…" : "导出"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
