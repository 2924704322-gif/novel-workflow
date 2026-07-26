"use client";

// 酒馆AI 详情页（FT-08 / FT-22 入口）
// FT-22：原「酒馆配置台」占位 chips 升级为真实入口按钮，点击打开 TavernConfigEntry
// （角色卡 / 世界书 / 群组 / 预设 四个管理器）。

import { useState } from "react";
import { useStudio } from "./StudioProvider";
import { Wine, Users, BookText, Layers, PanelRightClose } from "./icons";
import TavernConfigEntry from "./tavern/TavernConfigEntry";

export default function TavernDetail() {
  const { toggleRight, chat, openRoleplayPicker, selectedBookId } = useStudio();
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <>
      <div className="detail-head">
        <span className="detail-title">酒馆AI</span>
        <button
          type="button"
          className="detail-close"
          onClick={toggleRight}
          title="收起"
          aria-label="收起"
        >
          <PanelRightClose size={16} />
        </button>
      </div>

      <div className="right-rail tavern">
        <p className="muted">
          选角色 / 群组，进入中栏对话；或在「酒馆配置台」维护角色卡、世界书与群组。
        </p>

        <section className="tavern-entry">
          <div className="tavern-entry-head">
            <Layers size={16} />
            <span>酒馆配置台</span>
          </div>
          <p className="faint">角色卡库 / 世界书 / 群组 / 预设管理器。</p>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setConfigOpen(true)}
            >
              <Layers size={14} /> 打开配置台
            </button>
          </div>
          <div className="tavern-mgr-row">
            <span className="mgr-chip">
              <Users size={14} /> 角色卡
            </span>
            <span className="mgr-chip">
              <BookText size={14} /> 世界书
            </span>
            <span className="mgr-chip">
              <Wine size={14} /> 群组
            </span>
          </div>
        </section>

        <button
          type="button"
          className="btn-primary tavern-seed"
          onClick={openRoleplayPicker}
        >
          在酒馆里聊聊
        </button>
        {chat && (
          <button
            type="button"
            className="btn-ghost tavern-seed"
            onClick={() => chat.send("进入酒馆AI，开始一段角色对话")}
          >
            在创作中问问
          </button>
        )}
      </div>

      {configOpen && (
        <TavernConfigEntry
          projectId={selectedBookId}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </>
  );
}
