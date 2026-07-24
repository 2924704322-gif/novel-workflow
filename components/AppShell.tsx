"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TopBar from "@/components/TopBar";
import LeftRail from "@/components/LeftRail";
import AgentPanel from "@/components/AgentPanel";

/**
 * IDE 式三栏应用外壳（类 Qoder Desktop 的呈现形态）：
 *   顶栏（全宽） / 左资源栏 · 中工作区 · 右创作助手。
 * 左右栏均可拖拽调宽、可折叠，宽度与折叠状态持久化到 localStorage。
 * 视觉沿用暖阁暖色调，仅借布局骨架；不引入第三方分栏库以保持单 exe 交付。
 */
const LS_KEY = "atelier.shell.v1";
const LEFT_DEFAULT = 248;
const RIGHT_DEFAULT = 340;
const LEFT_MIN = 180;
const LEFT_MAX = 420;
const RIGHT_MIN = 280;
const RIGHT_MAX = 560;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [leftW, setLeftW] = useState(LEFT_DEFAULT);
  const [rightW, setRightW] = useState(RIGHT_DEFAULT);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [ready, setReady] = useState(false);

  // 加载持久化布局（在 effect 中读取，避免 SSR/CSR 首帧不一致）。
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<{
          leftW: number;
          rightW: number;
          leftOpen: boolean;
          rightOpen: boolean;
        }>;
        if (typeof s.leftW === "number") setLeftW(clamp(s.leftW, LEFT_MIN, LEFT_MAX));
        if (typeof s.rightW === "number") setRightW(clamp(s.rightW, RIGHT_MIN, RIGHT_MAX));
        if (typeof s.leftOpen === "boolean") setLeftOpen(s.leftOpen);
        if (typeof s.rightOpen === "boolean") setRightOpen(s.rightOpen);
      }
    } catch {
      // ignore malformed persisted state
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ leftW, rightW, leftOpen, rightOpen })
      );
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, [ready, leftW, rightW, leftOpen, rightOpen]);

  // ---- 拖拽调宽（原生 pointer 事件，无外部依赖） ----
  const drag = useRef<{ side: "left" | "right"; startX: number; startW: number } | null>(
    null
  );

  const onMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (d.side === "left") setLeftW(clamp(d.startW + dx, LEFT_MIN, LEFT_MAX));
    else setRightW(clamp(d.startW - dx, RIGHT_MIN, RIGHT_MAX));
  }, []);

  const onUp = useCallback(() => {
    drag.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }, [onMove]);

  const startDrag = (side: "left" | "right") => (e: React.PointerEvent) => {
    e.preventDefault();
    drag.current = {
      side,
      startX: e.clientX,
      startW: side === "left" ? leftW : rightW,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onMove, onUp]);

  return (
    <div className="appshell">
      <TopBar
        left={
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setLeftOpen((o) => !o)}
            title={leftOpen ? "收起侧栏" : "展开侧栏"}
            aria-label="切换侧栏"
          >
            ☰
          </button>
        }
        right={
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setRightOpen((o) => !o)}
            title={rightOpen ? "收起创作助手" : "展开创作助手"}
            aria-label="切换创作助手"
          >
            助手
          </button>
        }
      />

      <div className="appshell-body">
        {leftOpen ? (
          <>
            <aside className="rail" style={{ width: leftW }}>
              <LeftRail onCollapse={() => setLeftOpen(false)} />
            </aside>
            <div
              className="resize-handle"
              onPointerDown={startDrag("left")}
              role="separator"
              aria-orientation="vertical"
            />
          </>
        ) : (
          <button
            className="rail-reopen rail-reopen--left"
            onClick={() => setLeftOpen(true)}
            title="展开侧栏"
            aria-label="展开侧栏"
          >
            ›
          </button>
        )}

        <main className="appshell-center scroll-y">{children}</main>

        {rightOpen ? (
          <>
            <div
              className="resize-handle"
              onPointerDown={startDrag("right")}
              role="separator"
              aria-orientation="vertical"
            />
            <aside className="agentpanel-wrap" style={{ width: rightW }}>
              <AgentPanel onCollapse={() => setRightOpen(false)} />
            </aside>
          </>
        ) : (
          <button
            className="rail-reopen rail-reopen--right"
            onClick={() => setRightOpen(true)}
            title="展开创作助手"
            aria-label="展开创作助手"
          >
            ‹
          </button>
        )}
      </div>
    </div>
  );
}
