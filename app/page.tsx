"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchProjects, hasConfig } from "@/lib/client";

const ENTRIES = [
  {
    href: "/new",
    seal: "书",
    title: "开一本新书",
    desc: "起个书名，泡杯茶，先立个骨架，再慢慢往里填故事。",
    go: "从头开始写 →",
    grad: "linear-gradient(160deg, #d67e52, #a5502c)",
    glow: "rgba(214, 126, 82, 0.22)",
  },
  {
    href: "/style",
    seal: "拆",
    title: "拆书工坊",
    desc: "把喜欢的书拆开看看——学它的文风，或抽出设定，二创开新篇。",
    go: "拆一本来看看 →",
    grad: "linear-gradient(160deg, #d3a24c, #a97b1f)",
    glow: "rgba(211, 162, 76, 0.22)",
  },
  {
    href: "/continue",
    seal: "续",
    title: "续写一本书",
    desc: "导入一份 txt 底本，接着往下写。可套用拆好的文风与设定，自动记着前情。",
    go: "导入底本续写 →",
    grad: "linear-gradient(160deg, #6f8fae, #3f6690)",
    glow: "rgba(111, 143, 174, 0.22)",
  },
  {
    href: "/shelf",
    seal: "架",
    title: "我的书架",
    desc: "翻翻手边正在写的那些书，接着上次的地方继续落笔。",
    go: "回书架看看 →",
    grad: "linear-gradient(160deg, #7f9b6e, #4f7a52)",
    glow: "rgba(127, 155, 110, 0.22)",
  },
];

export default function HomePage() {
  const [count, setCount] = useState<number | null>(null);
  const [configReady, setConfigReady] = useState(true);

  useEffect(() => {
    fetchProjects().then((ps) => setCount(ps.length));
    setConfigReady(hasConfig());
  }, []);

  return (
    <>
      {/* Hero — relaxed, unhurried welcome */}
      <section className="shell" style={{ paddingTop: 76, paddingBottom: 30 }}>
        <div className="fadeup" style={{ maxWidth: 720 }}>
          <div className="chip chip--cinnabar" style={{ marginBottom: 20 }}>
            不赶稿 · 不焦虑 · 一章一章慢慢来
          </div>
          <h1 style={{ fontSize: 46, lineHeight: 1.2, marginBottom: 18 }}>
            找个舒服的姿势，
            <br />
            <span style={{ color: "var(--cinnabar-deep)" }}>把心里的故事</span>
            写出来。
          </h1>
          <p className="muted" style={{ fontSize: 16, maxWidth: 560 }}>
            这里是你的暖阁书房。想写就写，写累了就去拆本别人的书取取经，
            回头再翻翻书架上没写完的那几本——一切都不急。
          </p>
        </div>
      </section>

      {!configReady && (
        <section className="shell" style={{ paddingBottom: 8 }}>
          <div
            className="panel"
            style={{
              padding: "14px 18px",
              display: "flex",
              alignItems: "center",
              gap: 14,
              borderColor: "rgba(197,106,63,.4)",
            }}
          >
            <span className="dot dot--draft" />
            <span className="muted" style={{ flex: 1 }}>
              还没接上模型接口，生成功能先歇着。填入 API 地址、Key 和模型名就能开工。
            </span>
            <Link href="/settings" className="btn btn--primary btn--sm">
              去设置
            </Link>
          </div>
        </section>
      )}

      {/* Three entries */}
      <main className="shell" style={{ paddingTop: 24, paddingBottom: 90 }}>
        <div className="entry-grid">
          {ENTRIES.map((e, i) => (
            <Link
              key={e.href}
              href={e.href}
              className="entry-card fadeup"
              style={
                {
                  animationDelay: `${i * 70}ms`,
                  ["--entry-glow" as string]: e.glow,
                } as React.CSSProperties
              }
            >
              <span className="entry-ico" style={{ background: e.grad }}>
                {e.seal}
              </span>
              <span className="entry-title">{e.title}</span>
              <span className="entry-desc">{e.desc}</span>
              <span className="entry-go">
                {e.href === "/shelf" && count !== null
                  ? `书架上有 ${count} 本 →`
                  : e.go}
              </span>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
