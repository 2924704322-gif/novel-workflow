"use client";

// 左栏纯导航（FT-04，取代旧 LeftRail）
//
// 结构：顶部「酒馆AI」入口 + 书架三书卡片（长夜行 / 山海拾遗 / 春山旧梦）。
// 选中高亮 + 状态点（.dot.write=jade 已成稿 / .skeleton=amber 草稿·进行中 /
// .brew=faint 酝酿中）。收起态 → 56px 图标轨（酒馆AI + 书架）。
// 书架数据本批用占位静态列表（终稿 §7 工作记忆：3 本固定样书），FT-05/08 可
// 改为读真实 projects / docsStore。

import { BookOpen, Wine, PanelLeftClose, PanelLeft } from "./icons";
import { useStudio } from "./StudioProvider";

type BookStatus = "write" | "skeleton" | "brew";

interface ShelfBook {
  id: string;
  title: string;
  status: BookStatus;
}

// 占位书架（本项目工作记忆确认的三本样书）。
const BOOKS: ShelfBook[] = [
  { id: "changyexing", title: "长夜行", status: "write" },
  { id: "shanhai-shiyi", title: "山海拾遗", status: "skeleton" },
  { id: "chunshan-jiu-meng", title: "春山旧梦", status: "brew" },
];

const STATUS_DOT: Record<BookStatus, string> = {
  write: "dot dot--write",
  skeleton: "dot dot--skeleton",
  brew: "dot dot--brew",
};

export default function LeftNav({
  collapsed,
  onToggleCollapse,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const { selectedBookId, rightMode, openBook, openTavern } = useStudio();

  if (collapsed) {
    return (
      <nav className="left-rail" aria-label="导航（收起）">
        <button
          className="nav-ico"
          title="展开导航"
          aria-label="展开导航"
          onClick={onToggleCollapse}
        >
          <PanelLeft />
        </button>
        <button
          className={"nav-ico" + (rightMode === "tavern" ? " active" : "")}
          title="酒馆AI"
          aria-label="酒馆AI"
          onClick={openTavern}
        >
          <Wine />
        </button>
        <button
          className="nav-ico"
          title="书架"
          aria-label="书架"
          onClick={onToggleCollapse}
        >
          <BookOpen />
        </button>
      </nav>
    );
  }

  return (
    <nav className="left-inner" aria-label="导航">
      <div className="left-head">
        <span className="left-head-title">导航</span>
        <button
          className="btn btn--ghost btn--sm"
          onClick={onToggleCollapse}
          title="收起导航"
          aria-label="收起导航"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      <div className="left-scroll scroll-y">
        <button
          className={"nav-item" + (rightMode === "tavern" ? " active" : "")}
          onClick={openTavern}
        >
          <Wine size={18} />
          <span>酒馆AI</span>
        </button>

        <div className="rail-group-label" style={{ marginTop: 10 }}>
          书架
        </div>
        <div className="shelf">
          {BOOKS.map((b) => {
            const active = selectedBookId === b.id;
            return (
              <button
                key={b.id}
                className={"book-card" + (active ? " book-card--on" : "")}
                onClick={() => openBook(b.id)}
                aria-pressed={active}
              >
                <BookOpen size={16} />
                <span className="book-title">{b.title}</span>
                <span className={STATUS_DOT[b.status]} aria-hidden />
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
