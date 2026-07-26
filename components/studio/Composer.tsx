"use client";

// 输入器（FT-05）
// textarea（Enter 发送 / Shift+Enter 换行）+ 圆形「+」按钮 + 技能 chip + 发送/停止。
// 复用 useChat 的 send / stop / runSkill（由 ChatStudio 透传）。

import { Plus, Sparkles } from "./icons";
import { SKILLS_REGISTRY } from "@/lib/agent/skills";

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onTogglePlus: () => void;
  plusOpen: boolean;
  onToggleSkills: () => void;
  skillsOpen: boolean;
  onPickSkill: (id: string) => void;
  streaming: boolean;
  onStop: () => void;
  activeSkill?: string | null;
}

export default function Composer({
  value,
  onChange,
  onSend,
  onTogglePlus,
  plusOpen,
  onToggleSkills,
  skillsOpen,
  onPickSkill,
  streaming,
  onStop,
  activeSkill,
}: ComposerProps) {
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <div className="composer">
      <button
        className="plus-btn"
        onClick={onTogglePlus}
        aria-label="更多能力"
        aria-expanded={plusOpen}
        title="更多能力"
      >
        <Plus size={18} />
      </button>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, position: "relative" }}>
        {skillsOpen && (
          <div className="skill-pop" role="menu">
            <div className="skill-pop-head">技能库</div>
            {SKILLS_REGISTRY.map((s) => (
              <button key={s.id} className="skill-item" role="menuitem" onClick={() => onPickSkill(s.id)}>
                <span className="skill-name">{s.name}</span>
                <span className="skill-desc">{s.description}</span>
              </button>
            ))}
          </div>
        )}
        {activeSkill && (
          <div className="skill-badge">
            <Sparkles size={13} /> 技能执行中：{activeSkill}
          </div>
        )}
        <textarea
          className="composer-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={streaming ? "助手正在回复…" : "说点什么…（Enter 发送，Shift+Enter 换行）"}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button className="btn-ghost btn-sm" onClick={onToggleSkills} disabled={streaming} title="技能库">
          <Sparkles size={14} /> 技能
        </button>
        {streaming ? (
          <button className="btn-ghost btn-sm" onClick={onStop}>
            停止
          </button>
        ) : (
          <button className="btn-primary btn-sm" onClick={onSend} disabled={!value.trim()}>
            发送
          </button>
        )}
      </div>
    </div>
  );
}
