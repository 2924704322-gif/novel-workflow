"use client";

// 对话内模态（FT-05，浅层实现）
// 接口设置：本地模型/密钥表单（loadConfig / saveConfig）；
// 技能：技能库列表（点击触发 runSkill）。深功能后续迭代。

import { useEffect, useState } from "react";
import { X } from "./icons";
import { loadConfig, saveConfig } from "@/lib/client";
import { SKILLS_REGISTRY } from "@/lib/agent/skills";

export type ModalKind = "settings" | "skills";

export default function InDialogModal({
  kind,
  onClose,
  onPickSkill,
}: {
  kind: ModalKind;
  onClose: () => void;
  onPickSkill?: (id: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={kind === "settings" ? "接口设置" : "技能库"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <strong>{kind === "settings" ? "接口设置" : "技能库"}</strong>
          <button className="modal-x" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          {kind === "settings" ? <SettingsForm /> : <SkillsList onPick={onPickSkill} />}
        </div>
      </div>
    </div>
  );
}

function SettingsForm() {
  const [apiKey, setApiKey] = useState(() => loadConfig().apiKey);
  const [baseUrl, setBaseUrl] = useState(() => loadConfig().baseUrl);
  const [model, setModel] = useState(() => loadConfig().model);
  const [saved, setSaved] = useState(false);

  function save() {
    const prev = loadConfig();
    saveConfig({ baseUrl, apiKey, model, temperature: prev.temperature });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="field" style={{ gap: 14 }}>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        配置用于对话的模型与密钥（本地存储，仅本机使用）。
      </p>
      <label className="field">
        <span className="label">API Base</span>
        <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">API Key</span>
        <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">模型</span>
        <input className="input" value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      <button className="btn-primary" onClick={save}>
        {saved ? "已保存" : "保存"}
      </button>
    </div>
  );
}

function SkillsList({ onPick }: { onPick?: (id: string) => void }) {
  return (
    <div className="skill-list">
      {SKILLS_REGISTRY.map((s) => (
        <button key={s.id} className="skill-row" onClick={() => onPick?.(s.id)}>
          <span className="skill-name">{s.name}</span>
          <span className="skill-desc">{s.description}</span>
        </button>
      ))}
    </div>
  );
}
