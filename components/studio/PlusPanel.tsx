"use client";

// 「+」展开器（FT-05）
// 5 能力：开一本新书 / 续写 / 拆书工坊 → seedChat（进对话）；
//         接口设置 / 技能 → 对话内模态 InDialogModal。

import type { ComponentType } from "react";
import { BookText, RefreshCw, Layers, Settings, Sparkles, type IconProps } from "./icons";
import type { ModalKind } from "./InDialogModal";

interface PlusItem {
  label: string;
  hint: string;
  Icon: ComponentType<IconProps>;
  action: "seed" | "modal";
  kind?: ModalKind;
  seed?: string;
}

const ITEMS: PlusItem[] = [
  { label: "开一本新书", hint: "从零立骨架", Icon: BookText, action: "seed", seed: "开一本新书《新作》，先立世界观与分卷骨架。" },
  { label: "续写", hint: "接着上一章", Icon: RefreshCw, action: "seed", seed: "续写最近一章的草稿，保持基调与伏笔一致。" },
  { label: "拆书工坊", hint: "大纲→设定", Icon: Layers, action: "seed", seed: "进入拆书工坊：把一份大纲或原文拆解为结构化设定文档。" },
  { label: "接口设置", hint: "模型 / 密钥", Icon: Settings, action: "modal", kind: "settings" },
  { label: "技能", hint: "能力库", Icon: Sparkles, action: "modal", kind: "skills" },
];

export default function PlusPanel({
  onSeed,
  onOpenModal,
  onClose,
}: {
  onSeed: (text: string) => void;
  onOpenModal: (kind: ModalKind) => void;
  onClose: () => void;
}) {
  return (
    <div className="plus-panel" role="menu" aria-label="更多能力">
      {ITEMS.map((it) => (
        <button
          key={it.label}
          className="plus-item"
          role="menuitem"
          onClick={() => {
            if (it.action === "seed" && it.seed) onSeed(it.seed);
            else if (it.action === "modal" && it.kind) onOpenModal(it.kind);
            else onClose();
          }}
        >
          <span className="plus-item-ico">
            <it.Icon size={16} />
          </span>
          <span className="plus-item-text">
            <span className="plus-item-label">{it.label}</span>
            <span className="plus-item-hint">{it.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
