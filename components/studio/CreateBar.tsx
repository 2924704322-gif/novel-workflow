"use client";

// 顶部快速创作栏（FT-05 / Q6 承载范围）
// 四 chip：世界观 / 人物设定 / 大纲 / 章节 → 触发对应 type 的对话（seedChat）。

import type { ComponentType } from "react";
import { Globe, Users, ListTree, BookText, type IconProps } from "./icons";

export type CreateType = "world" | "character" | "outline" | "chapter";

interface ChipDef {
  type: CreateType;
  label: string;
  Icon: ComponentType<IconProps>;
}

const CHIPS: ChipDef[] = [
  { type: "world", label: "世界观", Icon: Globe },
  { type: "character", label: "人物设定", Icon: Users },
  { type: "outline", label: "大纲", Icon: ListTree },
  { type: "chapter", label: "章节", Icon: BookText },
];

export default function CreateBar({
  onPick,
  disabled,
}: {
  onPick: (type: CreateType) => void;
  disabled?: boolean;
}) {
  return (
    <div className="create-bar" role="toolbar" aria-label="快速创作">
      {CHIPS.map(({ type, label, Icon }) => (
        <button
          key={type}
          className="create-chip"
          disabled={disabled}
          onClick={() => onPick(type)}
        >
          <Icon size={15} />
          {label}
        </button>
      ))}
    </div>
  );
}
