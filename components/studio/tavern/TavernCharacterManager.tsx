"use client";

// 角色卡管理器（FT-22）—— 列表 / 导入(V2 JSON) / 导出 / 删除 / 新建 / 编辑基本字段。
// Q11：仅 V2 JSON 导入导出，不处理 PNG 内嵌。所有读写经 /api/tavern/characters。

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { CharacterCardV2 } from "@/lib/tavern/types";
import { Users, Plus, Download, X, RefreshCw } from "../icons";

/** 与 GET /api/tavern/characters 返回结构对齐（避免客户端引入服务端 store）。 */
interface CardMeta {
  codexId: string;
  name: string;
  updatedAt: number;
}

type EditableField =
  | "name"
  | "description"
  | "personality"
  | "scenario"
  | "first_mes"
  | "system_prompt";

const FIELDS: { key: EditableField; label: string; textarea?: boolean }[] = [
  { key: "name", label: "名称" },
  { key: "description", label: "描述", textarea: true },
  { key: "personality", label: "性格", textarea: true },
  { key: "scenario", label: "场景", textarea: true },
  { key: "first_mes", label: "开场白", textarea: true },
  { key: "system_prompt", label: "系统提示", textarea: true },
];

function blankCard(): CharacterCardV2 {
  const codexId = `char-${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "",
      description: "",
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      system_prompt: "",
      alternate_greetings: [],
      tags: [],
      creator: "",
      character_version: "1.0",
    },
    extensions: { novelchat: { codexId } },
  };
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface TavernCharacterManagerProps {
  projectId: string;
}

export default function TavernCharacterManager(
  _props: TavernCharacterManagerProps
) {
  const [cards, setCards] = useState<CardMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CharacterCardV2 | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tavern/characters");
      if (!res.ok) throw new Error(`加载失败 (${res.status})`);
      const data = (await res.json()) as { cards: CardMeta[] };
      setCards(data.cards ?? []);
    } catch (e) {
      setError((e as Error).message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startNew = useCallback(() => setEditing(blankCard()), []);

  const startEdit = useCallback(async (codexId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/tavern/characters/${encodeURIComponent(codexId)}`
      );
      if (!res.ok) throw new Error(`读取失败 (${res.status})`);
      const data = (await res.json()) as { card: CharacterCardV2 };
      setEditing(data.card);
    } catch (e) {
      setError((e as Error).message || "读取失败");
    } finally {
      setBusy(false);
    }
  }, []);

  const handleImportFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const text = await file.text();
        const card = JSON.parse(text) as CharacterCardV2;
        if (
          card.spec !== "chara_card_v2" ||
          !card.extensions?.novelchat?.codexId
        ) {
          throw new Error(
            "不是合法的 Character Card V2（缺少 extensions.novelchat.codexId）"
          );
        }
        const res = await fetch("/api/tavern/characters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(card),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(err?.error || `导入失败 (${res.status})`);
        }
        await load();
      } catch (e) {
        setError((e as Error).message || "导入失败");
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const handleExport = useCallback(async (codexId: string, name: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/tavern/characters/${encodeURIComponent(codexId)}`
      );
      if (!res.ok) throw new Error(`读取失败 (${res.status})`);
      const data = (await res.json()) as { card: CharacterCardV2 };
      const safe = (name || codexId).replace(/[^\w一-鿿-]+/g, "_");
      downloadJson(`${safe}.json`, data.card);
    } catch (e) {
      setError((e as Error).message || "导出失败");
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDelete = useCallback(
    async (codexId: string) => {
      if (!confirm("确定删除该角色卡？")) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/tavern/characters?codexId=${encodeURIComponent(codexId)}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error(`删除失败 (${res.status})`);
        await load();
      } catch (e) {
        setError((e as Error).message || "删除失败");
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const patchData = (key: EditableField, value: string) => {
    setEditing((prev) =>
      prev
        ? {
            ...prev,
            data: {
              ...prev.data,
              [key]: value,
            } as CharacterCardV2["data"],
          }
        : prev
    );
  };

  const saveEditing = useCallback(async () => {
    if (!editing) return;
    if (!editing.data.name.trim()) {
      setError("角色名不能为空");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tavern/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(err?.error || `保存失败 (${res.status})`);
      }
      setEditing(null);
      await load();
    } catch (e) {
      setError((e as Error).message || "保存失败");
    } finally {
      setBusy(false);
    }
  }, [editing, load]);

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: "8px 10px",
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
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={startNew}
          disabled={busy}
        >
          <Plus size={14} /> 新建角色卡
        </button>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <Download size={14} /> 导入 JSON
        </button>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => void load()}
          disabled={busy}
        >
          <RefreshCw size={14} /> 刷新
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleImportFile(f);
            e.target.value = "";
          }}
        />
        <span className="faint" style={{ fontSize: 12 }}>
          仅支持 V2 JSON（Q11：不含 PNG 内嵌）
        </span>
      </div>

      {error && (
        <p style={{ color: "var(--danger)", fontSize: 13, margin: "0 0 8px" }}>
          {error}
        </p>
      )}

      {editing ? (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: 16,
            background: "var(--surface-2)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <strong>
              {editing.extensions?.novelchat?.codexId ? "编辑角色卡" : "新建角色卡"}
            </strong>
            <button
              type="button"
              className="detail-close"
              onClick={() => setEditing(null)}
              aria-label="取消"
            >
              <X size={14} />
            </button>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {FIELDS.map((f) => (
              <label key={f.key} style={{ display: "block" }}>
                <span
                  className="faint"
                  style={{ fontSize: 12, display: "block", marginBottom: 4 }}
                >
                  {f.label}
                </span>
                {f.textarea ? (
                  <textarea
                    style={{ ...inputStyle, minHeight: 64, resize: "vertical" }}
                    value={editing.data[f.key]}
                    onChange={(e) => patchData(f.key, e.target.value)}
                  />
                ) : (
                  <input
                    style={inputStyle}
                    value={editing.data[f.key]}
                    onChange={(e) => patchData(f.key, e.target.value)}
                  />
                )}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => void saveEditing()}
              disabled={busy}
            >
              保存
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setEditing(null)}
              disabled={busy}
            >
              取消
            </button>
          </div>
        </div>
      ) : loading ? (
        <p className="muted">加载中…</p>
      ) : cards.length === 0 ? (
        <p className="muted">还没有角色卡，点击「新建角色卡」或「导入 JSON」。</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gap: 8,
          }}
        >
          {cards.map((c) => (
            <li
              key={c.codexId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: "8px 10px",
                background: "var(--surface)",
              }}
            >
              <Users size={15} />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.name}
              </span>
              <span className="faint" style={{ fontSize: 12 }}>
                {c.codexId}
              </span>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => void startEdit(c.codexId)}
                disabled={busy}
              >
                编辑
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => void handleExport(c.codexId, c.name)}
                disabled={busy}
              >
                导出
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => void handleDelete(c.codexId)}
                disabled={busy}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
