"use client";

// 酒馆配置台外壳（FT-22）—— 模态覆盖层，内含「角色卡 / 世界书 / 群组 / 预设」分段切换，
// 渲染对应的管理器。projectId 来自 useStudio().selectedBookId；为 null 时显示空状态并禁用。

import { useState } from "react";
import { X, Users, BookText, Wine, Settings } from "../icons";
import TavernCharacterManager from "./TavernCharacterManager";
import TavernLorebookEditor from "./TavernLorebookEditor";
import TavernGroupManager from "./TavernGroupManager";
import TavernPresetManager from "./TavernPresetManager";

type Tab = "characters" | "lorebooks" | "groups" | "presets";

const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
  { key: "characters", label: "角色卡", icon: Users },
  { key: "lorebooks", label: "世界书", icon: BookText },
  { key: "groups", label: "群组", icon: Wine },
  { key: "presets", label: "预设", icon: Settings },
];

export interface TavernConfigEntryProps {
  /** 当前打开的书 id；null 时禁用全部操作。 */
  projectId: string | null;
  onClose: () => void;
}

export default function TavernConfigEntry({ projectId, onClose }: TavernConfigEntryProps) {
  const [tab, setTab] = useState<Tab>("characters");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="tavern-config"
        style={{
          width: "min(880px, 94vw)",
          height: "min(720px, 92vh)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          boxShadow: "var(--shadow-float)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="detail-head">
          <span className="detail-title">酒馆配置台</span>
          <button
            type="button"
            className="detail-close"
            onClick={onClose}
            title="收起"
            aria-label="收起"
          >
            <X size={16} />
          </button>
        </div>

        {!projectId ? (
          <div
            style={{
              flex: 1,
              display: "grid",
              placeItems: "center",
              padding: "var(--space-6)",
              textAlign: "center",
            }}
          >
            <p className="muted">请先打开一本书，再配置酒馆角色卡 / 世界书 / 群组。</p>
          </div>
        ) : (
          <>
            <div
              style={{
                padding: "var(--space-3) var(--space-4)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div className="seg">
                {TABS.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      className={tab === t.key ? "on" : ""}
                      onClick={() => setTab(t.key)}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Icon size={14} /> {t.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflow: "auto",
                padding: "var(--space-4)",
              }}
            >
              {tab === "characters" && (
                <TavernCharacterManager projectId={projectId} />
              )}
              {tab === "lorebooks" && (
                <TavernLorebookEditor projectId={projectId} />
              )}
              {tab === "groups" && <TavernGroupManager projectId={projectId} />}
              {tab === "presets" && <TavernPresetManager projectId={projectId} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
