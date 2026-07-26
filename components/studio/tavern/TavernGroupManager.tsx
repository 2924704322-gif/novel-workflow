"use client";

// 群组管理器（FT-22）—— 列表 / 新建 / 编辑 / 删除；成员从角色卡中选取、可增删与上下排序。
// activationStrategy：Q9 MVP 仅 manual|list 可用，natural|pooled 标记为「后置」disabled。
// 全部读写经 /api/tavern/groups（与 /api/tavern/characters 取成员候选）。

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
} from "react";
import type { RoleplayGroup } from "@/lib/tavern/types";
import { Plus, X, RefreshCw, Wine, Users } from "../icons";

const LOCAL_OWNER = "local";

interface CharOption {
  codexId: string;
  name: string;
}

const STRATEGIES: {
  key: RoleplayGroup["activationStrategy"];
  label: string;
  disabled?: boolean;
}[] = [
  { key: "manual", label: "手动" },
  { key: "list", label: "列表轮转" },
  { key: "natural", label: "自然（后置）", disabled: true },
  { key: "pooled", label: "池化（后置）", disabled: true },
];

function blankGroup(projectId: string): RoleplayGroup {
  return {
    id: `grp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    novelchat: { ownerId: LOCAL_OWNER, projectId },
    members: [],
    disabledMembers: [],
    activationStrategy: "manual",
    generationMode: "swap",
    scenarioOverride: "",
    greeting: "",
    allowSelfResponses: false,
  };
}

export interface TavernGroupManagerProps {
  projectId: string;
}

export default function TavernGroupManager({ projectId }: TavernGroupManagerProps) {
  const [groups, setGroups] = useState<RoleplayGroup[]>([]);
  const [chars, setChars] = useState<CharOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [group, setGroup] = useState<RoleplayGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [gRes, cRes] = await Promise.all([
        fetch(`/api/tavern/groups?projectId=${encodeURIComponent(projectId)}`),
        fetch("/api/tavern/characters"),
      ]);
      if (!gRes.ok) throw new Error(`群组加载失败 (${gRes.status})`);
      if (!cRes.ok) throw new Error(`角色加载失败 (${cRes.status})`);
      const g = (await gRes.json()) as { groups: RoleplayGroup[] };
      const c = (await cRes.json()) as { cards: CharOption[] };
      setGroups(g.groups ?? []);
      setChars(c.cards ?? []);
      setSelectedId(g.groups && g.groups.length ? g.groups[0].id : null);
    } catch (e) {
      setError((e as Error).message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const found = groups.find((g) => g.id === selectedId) ?? null;
    setGroup(found ? (JSON.parse(JSON.stringify(found)) as RoleplayGroup) : null);
  }, [selectedId, groups]);

  const update = useCallback((patch: Partial<RoleplayGroup>) => {
    setGroup((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const addMember = useCallback((codexId: string) => {
    setGroup((prev) =>
      prev && !prev.members.includes(codexId)
        ? { ...prev, members: [...prev.members, codexId] }
        : prev
    );
  }, []);

  const removeMember = useCallback((codexId: string) => {
    setGroup((prev) =>
      prev ? { ...prev, members: prev.members.filter((m) => m !== codexId) } : prev
    );
  }, []);

  const moveMember = useCallback((index: number, dir: -1 | 1) => {
    setGroup((prev) => {
      if (!prev) return prev;
      const next = [...prev.members];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return { ...prev, members: next };
    });
  }, []);

  const createGroup = useCallback(() => {
    const ng = blankGroup(projectId);
    setGroups((prev) => [...prev, ng]);
    setSelectedId(ng.id);
  }, [projectId]);

  const save = useCallback(async () => {
    if (!group) return;
    if (!group.name.trim()) {
      setError("群组名不能为空");
      return;
    }
    setError(null);
    try {
      const res = await fetch("/api/tavern/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(group),
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
  }, [group, load]);

  const deleteGroup = useCallback(
    async (id: string) => {
      if (!confirm("确定删除该群组？")) return;
      setError(null);
      try {
        const res = await fetch(
          `/api/tavern/groups?id=${encodeURIComponent(id)}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error(`删除失败 (${res.status})`);
        setSelectedId(null);
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
  };

  const charName = (codexId: string) =>
    chars.find((c) => c.codexId === codexId)?.name ?? codexId;

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
          {groups.length === 0 && <option value="">（无群组）</option>}
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name || g.id}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={createGroup}
          disabled={loading}
        >
          <Plus size={14} /> 新建群组
        </button>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      {error && (
        <p style={{ color: "var(--danger)", fontSize: 13, margin: "0 0 8px" }}>
          {error}
        </p>
      )}

      {loading ? (
        <p className="muted">加载中…</p>
      ) : !group ? (
        <p className="muted">暂无群组，点击「新建群组」。</p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              display: "grid",
              gap: 10,
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
                群组名
              </span>
              <input
                style={inputStyle}
                value={group.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label style={{ display: "block" }}>
              <span
                className="faint"
                style={{ fontSize: 12, display: "block", marginBottom: 4 }}
              >
                场景覆盖 scenarioOverride
              </span>
              <textarea
                style={{ ...inputStyle, minHeight: 48, resize: "vertical", width: "100%" }}
                value={group.scenarioOverride ?? ""}
                onChange={(e) => update({ scenarioOverride: e.target.value })}
              />
            </label>
            <label style={{ display: "block" }}>
              <span
                className="faint"
                style={{ fontSize: 12, display: "block", marginBottom: 4 }}
              >
                问候语 greeting
              </span>
              <input
                style={inputStyle}
                value={group.greeting ?? ""}
                onChange={(e) => update({ greeting: e.target.value })}
              />
            </label>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                激活策略
                <select
                  style={inputStyle}
                  value={group.activationStrategy}
                  onChange={(e) =>
                    update({
                      activationStrategy: e.target
                        .value as RoleplayGroup["activationStrategy"],
                    })
                  }
                >
                  {STRATEGIES.map((s) => (
                    <option key={s.key} value={s.key} disabled={s.disabled}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                生成模式
                <select
                  style={inputStyle}
                  value={group.generationMode}
                  onChange={(e) =>
                    update({
                      generationMode: e.target.value as "swap" | "append",
                    })
                  }
                >
                  <option value="swap">轮换(swap)</option>
                  <option value="append">追加(append)</option>
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={!!group.allowSelfResponses}
                  onChange={(e) => update({ allowSelfResponses: e.target.checked })}
                />
                允许自我回复
              </label>
            </div>
          </div>

          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <strong>成员（{group.members.length}）</strong>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) addMember(e.target.value);
                  e.target.value = "";
                }}
                style={{ ...inputStyle, minWidth: 180 }}
              >
                <option value="">+ 添加成员…</option>
                {chars
                  .filter((c) => !group.members.includes(c.codexId))
                  .map((c) => (
                    <option key={c.codexId} value={c.codexId}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "grid",
                gap: 6,
              }}
            >
              {group.members.map((m, i) => (
                <li
                  key={m}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    padding: "6px 10px",
                    background: "var(--surface)",
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      textAlign: "center",
                      color: "var(--fg-faint)",
                      fontSize: 12,
                    }}
                  >
                    {i + 1}
                  </span>
                  <Users size={14} />
                  <span style={{ flex: 1 }}>{charName(m)}</span>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => moveMember(i, -1)}
                    disabled={i === 0}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => moveMember(i, 1)}
                    disabled={i === group.members.length - 1}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => removeMember(m)}
                  >
                    <X size={14} /> 移除
                  </button>
                </li>
              ))}
              {group.members.length === 0 && (
                <li className="faint" style={{ fontSize: 12 }}>
                  暂无成员，从右侧下拉添加。
                </li>
              )}
            </ul>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => void save()}
            >
              <Wine size={14} /> 保存群组
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => void deleteGroup(group.id)}
            >
              删除群组
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
