"use client";

// 世界书编辑器（FT-22）—— 列出项目级世界书、选择/新建、编辑容器参数与条目表，
// 保存经 /api/tavern/lorebooks。含「.md 同步」按钮（POST /api/tavern/sync 后重拉）。
// Q10：仅项目级 / 角色级世界书，无全局/默认层。

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
} from "react";
import type { Lorebook, LorebookEntry } from "@/lib/tavern/types";
import { RefreshCw, Plus, X, Download } from "../icons";

const LOCAL_OWNER = "local";

interface SyncResult {
  worldDocs: number;
  characterDocs: number;
  skipped: number;
  worldLorebookId: string;
}

function blankEntry(id: string): LorebookEntry {
  return {
    id,
    keys: [],
    content: "",
    enabled: true,
    insertion_order: 0,
    constant: false,
    position: "after_char",
    selective: false,
  };
}

function newLorebookId(projectId: string): string {
  return `proj-${projectId}-${Date.now().toString(36)}`;
}

export interface TavernLorebookEditorProps {
  projectId: string;
}

export default function TavernLorebookEditor({
  projectId,
}: TavernLorebookEditorProps) {
  const [books, setBooks] = useState<Lorebook[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [book, setBook] = useState<Lorebook | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/tavern/lorebooks?projectId=${encodeURIComponent(projectId)}`
      );
      if (!res.ok) throw new Error(`加载失败 (${res.status})`);
      const data = (await res.json()) as { lorebooks: Lorebook[] };
      const list = data.lorebooks ?? [];
      setBooks(list);
      const target =
        list.find((b) => b.id === `world-${projectId}`) ?? list[0] ?? null;
      setSelectedId(target ? target.id : null);
    } catch (e) {
      setError((e as Error).message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 选中某本世界书时载入可编辑副本（深拷贝，避免直接改列表源）。
  useEffect(() => {
    const found = books.find((b) => b.id === selectedId) ?? null;
    setBook(found ? (JSON.parse(JSON.stringify(found)) as Lorebook) : null);
  }, [selectedId, books]);

  const updateBook = useCallback((patch: Partial<Lorebook>) => {
    setBook((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const updateEntry = useCallback(
    (entryId: string, patch: Partial<LorebookEntry>) => {
      setBook((prev) =>
        prev
          ? {
              ...prev,
              entries: (prev.entries ?? []).map((e) =>
                e.id === entryId ? { ...e, ...patch } : e
              ),
            }
          : prev
      );
    },
    []
  );

  const addEntry = useCallback(() => {
    setBook((prev) => {
      if (!prev) return prev;
      const id = `${prev.id}__entry-${Date.now().toString(36)}`;
      const maxOrder = (prev.entries ?? []).reduce(
        (m, e) => Math.max(m, e.insertion_order ?? 0),
        0
      );
      return {
        ...prev,
        entries: [
          ...(prev.entries ?? []),
          { ...blankEntry(id), insertion_order: maxOrder + 1 },
        ],
      };
    });
  }, []);

  const removeEntry = useCallback((entryId: string) => {
    setBook((prev) =>
      prev
        ? { ...prev, entries: (prev.entries ?? []).filter((e) => e.id !== entryId) }
        : prev
    );
  }, []);

  const createBook = useCallback(() => {
    const id = newLorebookId(projectId);
    const nb: Lorebook = {
      id,
      name: "新建世界书",
      entries: [],
      novelchat: { ownerId: LOCAL_OWNER, projectId, kind: "project" },
    };
    setBooks((prev) => [...prev, nb]);
    setSelectedId(id);
  }, [projectId]);

  const save = useCallback(async () => {
    if (!book) return;
    setError(null);
    try {
      const res = await fetch("/api/tavern/lorebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(book),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(err?.error || `保存失败 (${res.status})`);
      }
      await load();
    } catch (e) {
      setError((e as Error).message || "保存失败");
    }
  }, [book, load]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/tavern/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(err?.error || `同步失败 (${res.status})`);
      }
      const data = (await res.json()) as { result: SyncResult };
      await load();
      setNotice(
        `同步完成：世界书 ${data.result.worldDocs} 条，角色卡 ${data.result.characterDocs} 条。`
      );
    } catch (e) {
      setError((e as Error).message || "同步失败");
    } finally {
      setSyncing(false);
    }
  }, [projectId, load]);

  const inputStyle: CSSProperties = {
    padding: "7px 9px",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface)",
    color: "var(--fg)",
    fontSize: 13,
    fontFamily: "inherit",
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <select
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value)}
          style={{ ...inputStyle, minWidth: 220 }}
          disabled={loading}
        >
          {books.length === 0 && <option value="">（无世界书）</option>}
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name || b.id}
              {b.id === `world-${projectId}` ? "（项目世界书）" : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={createBook}
          disabled={loading}
        >
          <Plus size={14} /> 新建世界书
        </button>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={14} /> 刷新
        </button>
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={() => void sync()}
          disabled={syncing || loading}
        >
          <RefreshCw size={14} /> .md 同步
        </button>
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
      ) : !book ? (
        <p className="muted">
          暂无世界书，点击「新建世界书」或在书籍中维护 .md 后点「.md 同步」。
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "flex-end",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: 12,
              background: "var(--surface-2)",
            }}
          >
            <label style={{ display: "block" }}>
              <span
                className="faint"
                style={{ fontSize: 12, display: "block", marginBottom: 4 }}
              >
                名称
              </span>
              <input
                style={inputStyle}
                value={book.name ?? ""}
                onChange={(e) => updateBook({ name: e.target.value })}
              />
            </label>
            <label style={{ display: "block" }}>
              <span
                className="faint"
                style={{ fontSize: 12, display: "block", marginBottom: 4 }}
              >
                扫描深度 scan_depth
              </span>
              <input
                type="number"
                style={{ ...inputStyle, width: 110 }}
                value={book.scan_depth ?? 20}
                onChange={(e) =>
                  updateBook({ scan_depth: Number(e.target.value) })
                }
              />
            </label>
            <label style={{ display: "block" }}>
              <span
                className="faint"
                style={{ fontSize: 12, display: "block", marginBottom: 4 }}
              >
                token 预算
              </span>
              <input
                type="number"
                style={{ ...inputStyle, width: 110 }}
                value={book.token_budget ?? 1024}
                onChange={(e) =>
                  updateBook({ token_budget: Number(e.target.value) })
                }
              />
            </label>
            <label
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
            >
              <input
                type="checkbox"
                checked={!!book.recursive_scanning}
                onChange={(e) =>
                  updateBook({ recursive_scanning: e.target.checked })
                }
              />
              递归扫描
            </label>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <strong>条目（{book.entries?.length ?? 0}）</strong>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={addEntry}
            >
              <Plus size={14} /> 新增条目
            </button>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {(book.entries ?? []).map((entry) => (
              <div
                key={entry.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: 10,
                  background: "var(--surface)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    marginBottom: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <input
                    style={{ ...inputStyle, flex: 1, minWidth: 160 }}
                    placeholder="触发词（逗号分隔）"
                    value={entry.keys.join(", ")}
                    onChange={(e) =>
                      updateEntry(entry.id, {
                        keys: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                  <label
                    style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}
                  >
                    <input
                      type="checkbox"
                      checked={!!entry.enabled}
                      onChange={(e) =>
                        updateEntry(entry.id, { enabled: e.target.checked })
                      }
                    />
                    启用
                  </label>
                  <label
                    style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}
                  >
                    <input
                      type="checkbox"
                      checked={!!entry.constant}
                      onChange={(e) =>
                        updateEntry(entry.id, { constant: e.target.checked })
                      }
                    />
                    常驻
                  </label>
                  <label
                    style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}
                  >
                    <input
                      type="checkbox"
                      checked={!!entry.selective}
                      onChange={(e) =>
                        updateEntry(entry.id, { selective: e.target.checked })
                      }
                    />
                    选择性
                  </label>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => removeEntry(entry.id)}
                  >
                    <X size={14} /> 删除
                  </button>
                </div>
                <textarea
                  style={{ ...inputStyle, width: "100%", minHeight: 56, resize: "vertical" }}
                  placeholder="内容"
                  value={entry.content}
                  onChange={(e) => updateEntry(entry.id, { content: e.target.value })}
                />
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    marginTop: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <label
                    style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}
                  >
                    插入序{" "}
                    <input
                      type="number"
                      style={{ ...inputStyle, width: 80 }}
                      value={entry.insertion_order ?? 0}
                      onChange={(e) =>
                        updateEntry(entry.id, {
                          insertion_order: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label
                    style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}
                  >
                    位置
                    <select
                      style={inputStyle}
                      value={entry.position ?? "after_char"}
                      onChange={(e) =>
                        updateEntry(entry.id, {
                          position: e.target.value as "before_char" | "after_char",
                        })
                      }
                    >
                      <option value="after_char">角色后</option>
                      <option value="before_char">角色前</option>
                    </select>
                  </label>
                </div>
              </div>
            ))}
            {(book.entries?.length ?? 0) === 0 && (
              <p className="faint" style={{ fontSize: 12 }}>
                暂无条目。
              </p>
            )}
          </div>

          <div>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => void save()}
            >
              <Download size={14} /> 保存世界书
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
