// FT-06 冒烟测试（纯逻辑，node 环境无需 DOM）：
// 校验 mock 流在写意图下产出的提案符合 ChangeProposal.md 契约（MdDraft 形状、Q12 targetChapterId）。
import { describe, it, expect } from "vitest";
import { mockChatStream } from "./mockStream";
import type { AgentChatRequest, AgentStreamEvent } from "./types";

function mkReq(text: string): AgentChatRequest {
  return {
    config: { baseUrl: "https://example", apiKey: "", model: "m", temperature: 0 },
    messages: [{ role: "user", content: text }],
  };
}

async function collect(text: string): Promise<AgentStreamEvent[]> {
  const out: AgentStreamEvent[] = [];
  for await (const ev of mockChatStream(mkReq(text))) out.push(ev);
  return out;
}

describe("mockChatStream md proposal (FT-06)", () => {
  it("emits a proposal carrying md:MdDraft for a creation intent", async () => {
    const events = await collect("生成这本书的世界观设定 .md");
    const proposal = events.find((e) => e.type === "proposal");
    expect(proposal).toBeTruthy();
    if (proposal && proposal.type === "proposal") {
      expect(proposal.proposal.md).toBeDefined();
      expect(proposal.proposal.md?.kind).toBe("setting");
      expect(proposal.proposal.md?.fileName).toMatch(/\.md$/);
      expect(typeof proposal.proposal.md?.body).toBe("string");
    }
  });

  it("chapter intent yields kind=chapter with targetChapterId (Q12)", async () => {
    const events = await collect("续写第1章正文草稿");
    const proposal = events.find((e) => e.type === "proposal");
    expect(proposal?.type === "proposal" && proposal.proposal.md?.kind).toBe("chapter");
    expect(proposal?.type === "proposal" && proposal.proposal.md?.targetChapterId).toBeTruthy();
  });

  it("non-write intent yields no proposal", async () => {
    const events = await collect("聊聊今天的天气");
    expect(events.some((e) => e.type === "proposal")).toBe(false);
  });
});
