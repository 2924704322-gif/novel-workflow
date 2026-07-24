"use client";

// Sub B 开发用宿主页：把 AgentChat 挂在类右侧 AgentPanel 位上预览。
// 后端就绪、rebase 到含 AppShell 的 main 后，改由 AppShell 的 AgentPanel 槽位承载。

import TopBar from "@/components/TopBar";
import AgentChat from "@/components/AgentChat";

export default function AgentDevPage() {
  return (
    <>
      <TopBar />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 420px",
          gap: 20,
          maxWidth: 1180,
          margin: "0 auto",
          padding: "24px",
          height: "calc(100vh - 62px)",
          boxSizing: "border-box",
        }}
      >
        <section style={{ overflowY: "auto" }}>
          <div className="chip chip--cinnabar" style={{ marginBottom: 14 }}>
            开发预览 · mock 流
          </div>
          <h1 style={{ fontSize: 30, marginBottom: 12 }}>对话式写作助手</h1>
          <p className="muted" style={{ maxWidth: 520 }}>
            右侧面板对着 <code>lib/agent/types.ts</code> 契约用 mock 流开发：文本增量、工具调用、
            以及写操作的「变更提案 → 确认/取消」闭环。试着说「新建一本书」触发提案流程。
          </p>
          <p className="muted" style={{ maxWidth: 520 }}>
            联调时把 <code>AgentChat</code> 的 <code>transport</code> 换成
            <code>httpChatStream(apiBase)</code> 即指向真实 <code>/api/agent/chat</code>。
          </p>
        </section>
        <aside style={{ minHeight: 0 }}>
          <AgentChat />
        </aside>
      </div>
    </>
  );
}
