"use client";

// 预设管理器（FT-22）—— 表单 + 提交至 /api/tavern/presets。
// P1-2 修复：后端已接通 tavernStore 真实落库（data/tavern/presets/<id>.json），
// 保存后刷新列表、支持删除，摘除旧「stub 未持久化」提示。

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
} from "react";
import type { TavernPreset } from "@/lib/tavern/types";
import { Plus, RefreshCw, Settings, Trash2 } from "../icons";

const LOCAL_OWNER = "local";

export interface TavernPresetManagerProps {
  projectId: string;
}

export default function TavernPresetManager({ projectId }: TavernPresetManagerProps) {
  const [presets, setPresets] = useState<TavernPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [systemPromptTemplate, setSystemPromptTemplate] = useState("");
  const [scanDepth, setScanDepth] = useState(20);
  const [tokenBudget, setTokenBudget] = useState(1024);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/tavern/presets?projectId=${encodeURIComponent(projectId)}`
      );
      if (!res.ok) throw new Error(`加载失败 (${res.status})`);
      const data = (await res.json()) as { presets: TavernPreset[] };
      setPresets(data.presets ?? []);
    } catch (e) {
      setError((e as Error).message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(async () => {
    if (!name.trim()) {
      setError("预设名不能为空");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const preset: TavernPreset = {
        id: `preset-${Date.now().toString(36)}${Math.random()
          .toString(36)
          .slice(2, 6)}`,
        name,
        systemPromptTemplate: systemPromptTemplate || undefined,
        scanDepth: scanDepth || undefined,
        tokenBudget: tokenBudget || undefined,
        novelchat: { ownerId: LOCAL_OWNER, projectId },
      };
      const res = await fetch("/api/tavern/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preset),
      });
      if (!res.ok) throw new Error(`提交失败 (${res.status})`);
      // P1-2：后端已真实落库，保存后刷新列表即时可见。
      setNotice("预设已保存。");
      setName("");
      setSystemPromptTemplate("");
      setScanDepth(20);
      setTokenBudget(1024);
      await load();
    } catch (e) {
      setError((e as Error).message || "提交失败");
    } finally {
      setBusy(false);
    }
  }, [name, systemPromptTemplate, scanDepth, tokenBudget, projectId, load]);

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const res = await fetch(
          `/api/tavern/presets?id=${encodeURIComponent(id)}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error(`删除失败 (${res.status})`);
        await load();
      } catch (e) {
        setError((e as Error).message || "删除失败");
      }
    },
    [load]
  );

  const inputStyle: CSSProperties = {
    padding: "7px 9px",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface)",
    color: "var(--fg)",
    fontSize: 13,
    fontFamily: "inherit",
    width: "100%",
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={14} /> 刷新
        </button>
        <span className="faint" style={{ fontSize: 12 }}>
          预设保存在本地（data/tavern/presets）
        </span>
      </div>

      {error && (
        <p style={{ color: "var(--danger)", fontSize: 13, margin: "0 0 8px" }}>
          {error}
        </p>
      )}
      {notice && (
        <p style={{ color: "var(--jade)", fontSize: 13, margin: "0 0 8px" }}>
          {notice}
        </p>
      )}

      {loading ? (
        <p className="muted">加载中…</p>
      ) : presets.length === 0 ? (
        <p className="muted">还没有预设。填写下方表单新建一个。</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: "0 0 12px",
            padding: 0,
            display: "grid",
            gap: 6,
          }}
        >
          {presets.map((p) => (
            <li
              key={p.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: "8px 10px",
                background: "var(--surface)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Settings size={14} />
              <span style={{ flex: 1 }}>{p.name}</span>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => void remove(p.id)}
                title="删除预设"
                aria-label={`删除预设 ${p.name ?? p.id}`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: 12,
          background: "var(--surface-2)",
          display: "grid",
          gap: 10,
        }}
      >
        <strong>新建预设</strong>
        <label style={{ display: "block" }}>
          <span
            className="faint"
            style={{ fontSize: 12, display: "block", marginBottom: 4 }}
          >
            名称
          </span>
          <input
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label style={{ display: "block" }}>
          <span
            className="faint"
            style={{ fontSize: 12, display: "block", marginBottom: 4 }}
          >
            系统提示模板
          </span>
          <textarea
            style={{ ...inputStyle, minHeight: 56, resize: "vertical" }}
            value={systemPromptTemplate}
            onChange={(e) => setSystemPromptTemplate(e.target.value)}
          />
        </label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label style={{ display: "block", flex: 1 }}>
            <span
              className="faint"
              style={{ fontSize: 12, display: "block", marginBottom: 4 }}
            >
              扫描深度
            </span>
            <input
              type="number"
              style={inputStyle}
              value={scanDepth}
              onChange={(e) => setScanDepth(Number(e.target.value))}
            />
          </label>
          <label style={{ display: "block", flex: 1 }}>
            <span
              className="faint"
              style={{ fontSize: 12, display: "block", marginBottom: 4 }}
            >
              token 预算
            </span>
            <input
              type="number"
              style={inputStyle}
              value={tokenBudget}
              onChange={(e) => setTokenBudget(Number(e.target.value))}
            />
          </label>
        </div>
        <div>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => void submit()}
            disabled={busy}
          >
            <Plus size={14} /> 提交预设
          </button>
        </div>
      </div>
    </div>
  );
}
