"use client";

// SkillPicker —— 技能选择面板。
// 网格展示可用技能卡片，点击后展开参数表单，确认后触发技能执行。

import { useState } from "react";
import { SKILLS_REGISTRY, type AgentSkill, type SkillParam } from "@/lib/agent/skills";

export interface SkillPickerProps {
  onSelect: (skillId: string, params: Record<string, string>) => void;
  disabled?: boolean;
}

export default function SkillPicker({ onSelect, disabled }: SkillPickerProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});

  function handleCardClick(skill: AgentSkill) {
    if (disabled) return;
    if (skill.params && skill.params.length > 0) {
      setExpanded(skill.id);
      setParams({});
    } else {
      onSelect(skill.id, {});
    }
  }

  function handleSubmit(skill: AgentSkill) {
    // 校验必填参数。
    for (const p of skill.params || []) {
      if (p.required && !params[p.name]?.trim()) return;
    }
    onSelect(skill.id, params);
    setExpanded(null);
    setParams({});
  }

  const groups = {
    writing: SKILLS_REGISTRY.filter((s) => s.group === "writing"),
    planning: SKILLS_REGISTRY.filter((s) => s.group === "planning"),
    maintenance: SKILLS_REGISTRY.filter((s) => s.group === "maintenance"),
  };

  const groupLabels: Record<string, string> = {
    writing: "写作",
    planning: "规划",
    maintenance: "维护",
  };

  return (
    <div style={S.container}>
      {(["writing", "planning", "maintenance"] as const).map((g) => (
        <div key={g}>
          <div style={S.groupLabel}>{groupLabels[g]}</div>
          <div style={S.grid}>
            {groups[g].map((skill) => (
              <div key={skill.id}>
                <button
                  style={{
                    ...S.card,
                    ...(expanded === skill.id ? S.cardActive : {}),
                    opacity: disabled ? 0.5 : 1,
                  }}
                  onClick={() => handleCardClick(skill)}
                  disabled={disabled}
                >
                  <strong style={S.cardName}>{skill.name}</strong>
                  <span style={S.cardDesc}>{skill.description}</span>
                </button>

                {expanded === skill.id && (
                  <div style={S.paramForm}>
                    {(skill.params || []).map((p) => (
                      <ParamField
                        key={p.name}
                        param={p}
                        value={params[p.name] || ""}
                        onChange={(v) => setParams((prev) => ({ ...prev, [p.name]: v }))}
                      />
                    ))}
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        className="btn btn--primary btn--sm"
                        onClick={() => handleSubmit(skill)}
                      >
                        执行
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => setExpanded(null)}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ParamField({
  param,
  value,
  onChange,
}: {
  param: SkillParam;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <label style={S.paramLabel}>
        {param.label}
        {param.required && <span style={{ color: "var(--cinnabar)" }}>*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={param.source ? `输入 ${param.source} 的 id` : "输入值"}
        style={S.paramInput}
      />
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "8px 0",
  },
  groupLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--fg-faint)",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
    paddingLeft: 2,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  },
  card: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--line-strong)",
    background: "var(--ink-800)",
    cursor: "pointer",
    textAlign: "left",
    transition: "border-color 0.15s",
  },
  cardActive: {
    borderColor: "var(--cinnabar)",
    background: "rgba(197,106,63,0.06)",
  },
  cardName: {
    fontSize: 13,
    fontFamily: "var(--font-serif)",
    color: "var(--fg)",
  },
  cardDesc: {
    fontSize: 11,
    color: "var(--fg-dim)",
    lineHeight: 1.3,
  },
  paramForm: {
    padding: "10px 12px",
    marginTop: 4,
    borderRadius: 8,
    border: "1px solid var(--line)",
    background: "var(--paper)",
  },
  paramLabel: {
    display: "block",
    fontSize: 12,
    marginBottom: 3,
    color: "var(--fg-dim)",
  },
  paramInput: {
    width: "100%",
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid var(--line-strong)",
    background: "var(--ink-800)",
    color: "var(--fg)",
    fontSize: 13,
  },
};
