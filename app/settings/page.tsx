"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DEFAULT_CONFIG,
  addProfile,
  deleteProfile,
  getActiveProfile,
  loadProfiles,
  setActiveProfile,
  updateProfile,
  type ApiProfile,
} from "@/lib/client";
import type { ApiConfig } from "@/lib/types";

const PRESETS: { label: string; baseUrl: string; model: string }[] = [
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-v4-flash" },
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "Moonshot", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { label: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
];

export default function SettingsPage() {
  const [profiles, setProfiles] = useState<ApiProfile[]>([]);
  const [activeId, setActiveId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [mounted, setMounted] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  function refresh(editId?: string) {
    const s = loadProfiles();
    setProfiles(s.profiles);
    setActiveId(s.activeId);
    setEditingId((cur) => {
      const want = editId ?? cur;
      return s.profiles.some((p) => p.id === want) ? want : s.activeId;
    });
  }

  useEffect(() => {
    setMounted(true);
    const s = loadProfiles();
    setProfiles(s.profiles);
    setActiveId(s.activeId);
    setEditingId(getActiveProfile().id);
  }, []);

  const editing = profiles.find((p) => p.id === editingId) ?? profiles[0];
  const cfg: ApiConfig = editing ? editing.config : DEFAULT_CONFIG;

  function updateField<K extends keyof ApiConfig>(key: K, val: ApiConfig[K]) {
    if (!editing) return;
    updateProfile(editing.id, { config: { ...editing.config, [key]: val } });
    setTestMsg(null);
    refresh();
  }

  function rename(name: string) {
    if (!editing) return;
    updateProfile(editing.id, { name });
    refresh();
  }

  function applyPreset(p: { baseUrl: string; model: string }) {
    if (!editing) return;
    updateProfile(editing.id, {
      config: { ...editing.config, baseUrl: p.baseUrl, model: p.model },
    });
    setTestMsg(null);
    refresh();
  }

  function handleAdd() {
    const p = addProfile("新配置", { ...DEFAULT_CONFIG });
    setTestMsg(null);
    refresh(p.id);
  }

  function handleDelete(id: string) {
    deleteProfile(id);
    setTestMsg(null);
    const s = loadProfiles();
    setProfiles(s.profiles);
    setActiveId(s.activeId);
    setEditingId(s.activeId);
  }

  function handleSetActive(id: string) {
    setActiveProfile(id);
    refresh();
  }

  async function handleTest() {
    if (!editing) return;
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await fetch("/api/generate/chapter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: cfg,
          setup: { wordsPerChapter: 20, style: "" },
          bible: {
            logline: "连通性测试",
            synopsis: "",
            worldbuilding: "",
            themes: "",
            tone: "",
            characters: [],
          },
          volume: { title: "测试卷", summary: "", index: 1, id: "t", chapters: [] },
          chapter: {
            id: "t",
            index: 1,
            title: "握手",
            synopsis: "请只回复两个字：可用。",
            content: "",
            wordCount: 0,
            status: "empty",
            updatedAt: 0,
          },
          prevChapter: null,
        }),
      });
      const text = await res.text();
      if (res.ok) {
        setTestMsg({ ok: true, text: `连接正常，模型回复：${text.slice(0, 40)}` });
      } else {
        setTestMsg({ ok: false, text: text.slice(0, 200) || "连接失败" });
      }
    } catch (e) {
      setTestMsg({ ok: false, text: e instanceof Error ? e.message : "连接失败" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <main className="shell" style={{ paddingTop: 48, paddingBottom: 80, maxWidth: 760 }}>
        <Link href="/" className="faint" style={{ fontSize: 13 }}>
          ← 返回书房
        </Link>
        <h1 style={{ fontSize: 30, margin: "14px 0 6px" }}>模型接口设置</h1>
        <p className="muted" style={{ marginBottom: 28 }}>
          可保存多套兼容 OpenAI 协议的接口配置，随时切换正在使用的一套。密钥仅保存在本机浏览器，随请求转发给你指定的服务商，不会上传到其他地方。修改会自动保存。
        </p>

        {mounted && (
          <div className="panel" style={{ padding: 22, marginBottom: 20 }}>
            <div className="codex-head">
              <span className="label" style={{ margin: 0 }}>已保存的配置</span>
              <button className="btn btn--ghost btn--sm" onClick={handleAdd}>
                + 新增配置
              </button>
            </div>
            <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
              {profiles.map((p) => {
                const isActive = p.id === activeId;
                const isEditing = p.id === editingId;
                return (
                  <div
                    key={p.id}
                    className="profile-row"
                    data-editing={isEditing ? "1" : undefined}
                    onClick={() => setEditingId(p.id)}
                  >
                    <span className={isActive ? "dot dot--done" : "dot dot--draft"} aria-hidden />
                    <span style={{ fontWeight: 600, flex: "0 0 auto" }}>{p.name}</span>
                    <span className="faint" style={{ fontSize: 12, marginLeft: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.config.model || "未设模型"}
                    </span>
                    <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                      {isActive ? (
                        <span className="chip chip--jade">使用中</span>
                      ) : (
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetActive(p.id);
                          }}
                        >
                          设为使用中
                        </button>
                      )}
                      <button
                        className="btn btn--ghost btn--sm"
                        title="删除此配置"
                        disabled={profiles.length <= 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(p.id);
                        }}
                      >
                        删除
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {mounted && editing && (
          <div className="panel" style={{ padding: 26 }}>
            <div className="field" style={{ marginBottom: 18 }}>
              <label className="label" htmlFor="pname">
                配置名称
              </label>
              <input
                id="pname"
                className="input"
                value={editing.name}
                onChange={(e) => rename(e.target.value)}
                placeholder="例如：DeepSeek 主力 / OpenAI 备用"
              />
            </div>

            <div className="field" style={{ marginBottom: 20 }}>
              <span className="label">快速填充</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className="btn btn--ghost btn--sm"
                    onClick={() => applyPreset(p)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field" style={{ marginBottom: 18 }}>
              <label className="label" htmlFor="baseUrl">
                API 地址（Base URL）
              </label>
              <input
                id="baseUrl"
                className="input"
                value={cfg.baseUrl}
                onChange={(e) => updateField("baseUrl", e.target.value)}
                placeholder="https://api.deepseek.com/v1"
              />
              <span className="hint">
                一般以 /v1 结尾。若只填域名，会自动补上 /v1。
              </span>
            </div>

            <div className="field" style={{ marginBottom: 18 }}>
              <label className="label" htmlFor="apiKey">
                API Key
              </label>
              <input
                id="apiKey"
                className="input"
                type="password"
                value={cfg.apiKey}
                onChange={(e) => updateField("apiKey", e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 200px",
                gap: 16,
                marginBottom: 22,
              }}
            >
              <div className="field">
                <label className="label" htmlFor="model">
                  模型名称
                </label>
                <input
                  id="model"
                  className="input"
                  value={cfg.model}
                  onChange={(e) => updateField("model", e.target.value)}
                  placeholder="deepseek-v4-flash"
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="temp">
                  创造性（temperature）
                </label>
                <input
                  id="temp"
                  className="input"
                  type="number"
                  step="0.05"
                  min="0"
                  max="2"
                  value={cfg.temperature}
                  onChange={(e) =>
                    // 归一到两位小数，避免 float32 精度长尾（如 0.8500000238…）入库
                    updateField(
                      "temperature",
                      Math.round((parseFloat(e.target.value) || 0) * 100) / 100
                    )
                  }
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {editing.id === activeId ? (
                <span className="chip chip--jade">这套配置正在使用</span>
              ) : (
                <button
                  className="btn btn--primary"
                  onClick={() => handleSetActive(editing.id)}
                >
                  设为使用中
                </button>
              )}
              <button
                className="btn btn--ghost"
                onClick={handleTest}
                disabled={testing}
              >
                {testing ? "测试中…" : "测试连接"}
              </button>
            </div>

            {testMsg && (
              <div
                className={testMsg.ok ? "chip chip--jade" : "chip chip--cinnabar"}
                style={{ marginTop: 16, display: "block", padding: "10px 14px", lineHeight: 1.5 }}
              >
                {testMsg.text}
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}
