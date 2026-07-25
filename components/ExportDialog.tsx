"use client";

import { useState } from "react";
import type { ExportFormat } from "@/lib/export/types";

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

  if (!open) return null;

  const handleExport = async () => {
    setLoading(true);
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
    } catch (err) {
      alert(`导出失败：${(err as Error).message}`);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-neutral-800 rounded-lg shadow-xl w-full max-w-md p-5">
        <h2 className="text-lg font-semibold text-neutral-100 mb-4">导出作品</h2>

        {/* 格式选择 */}
        <div className="mb-4">
          <label className="block text-sm text-neutral-400 mb-2">导出格式</label>
          <div className="grid grid-cols-3 gap-2">
            {formats.map((f) => (
              <button
                key={f.value}
                onClick={() => setFormat(f.value)}
                className={`p-2 rounded border text-center text-sm transition-colors ${
                  format === f.value
                    ? "border-amber-500 bg-amber-900/30 text-amber-200"
                    : "border-neutral-600 hover:border-neutral-500 text-neutral-300"
                }`}
              >
                <div className="font-medium">{f.label}</div>
                <div className="text-xs text-neutral-500 mt-0.5">{f.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 范围 */}
        <div className="mb-4">
          <label className="block text-sm text-neutral-400 mb-2">导出范围</label>
          <div className="flex gap-3">
            <label className="flex items-center gap-1.5 text-sm text-neutral-300">
              <input
                type="radio"
                checked={scope === "full"}
                onChange={() => setScope("full")}
                className="accent-amber-500"
              />
              全书
            </label>
            <label className="flex items-center gap-1.5 text-sm text-neutral-300">
              <input
                type="radio"
                checked={scope === "volume"}
                onChange={() => setScope("volume")}
                className="accent-amber-500"
              />
              单卷
            </label>
            {scope === "volume" && (
              <select
                value={volumeIndex}
                onChange={(e) => setVolumeIndex(Number(e.target.value))}
                className="ml-2 px-2 py-1 rounded bg-neutral-700 border border-neutral-600 text-sm text-neutral-200"
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
        <div className="mb-5 space-y-2">
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={includeOutline}
              onChange={(e) => setIncludeOutline(e.target.checked)}
              className="accent-amber-500"
            />
            包含故事设定
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={includeNotes}
              onChange={(e) => setIncludeNotes(e.target.checked)}
              className="accent-amber-500"
            />
            包含章节概要
          </label>
        </div>

        {/* 操作 */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded border border-neutral-600 text-neutral-300 hover:bg-neutral-700"
          >
            取消
          </button>
          <button
            onClick={handleExport}
            disabled={loading}
            className="px-4 py-2 text-sm rounded bg-amber-600 hover:bg-amber-500 text-white font-medium disabled:opacity-50"
          >
            {loading ? "导出中..." : "导出"}
          </button>
        </div>
      </div>
    </div>
  );
}
