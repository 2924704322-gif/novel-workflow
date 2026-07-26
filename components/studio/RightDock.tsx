"use client";

// 右栏双详情页容器（FT-08）
//
// 内部渲染两个**完全独立**的 detail-page（#page-book / #page-tavern），靠 rightMode 切换
// CSS class 互斥显示（globals.css：.detail-page { display:none } .is-open { display:flex }）。
// 同一时刻仅一个 rightMode 生效 → 两页永不同时存在（对齐终稿 §9.5）。

import { useStudio } from "./StudioProvider";
import BookDetail from "./BookDetail";
import TavernDetail from "./TavernDetail";

export default function RightDock() {
  const { rightMode } = useStudio();

  return (
    <div className="right-dock">
      <section
        id="page-book"
        className={"detail-page" + (rightMode === "book" ? " is-open" : "")}
      >
        <BookDetail />
      </section>

      <section
        id="page-tavern"
        className={"detail-page" + (rightMode === "tavern" ? " is-open" : "")}
      >
        <TavernDetail />
      </section>
    </div>
  );
}
