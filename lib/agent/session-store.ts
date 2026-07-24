// Agent 会话与待确认提案的持久化（系统规范 §3.3 / §3.5 / §3.6）。
//
// 云就绪：会话与提案一律经 Repository 落存储（本地即 JSON 单档，未来换 DB），
// 服务端 Agent 循环保持无状态——跨轮所需的“待确认写操作”不放进程内存，
// 而是持久化后凭 ConfirmToken.proposalId 在下一轮取回执行。
//
// 归属：Sub A（后端）。低层文件路径复用 lib/storage.ts 的 dataRoot()，
// 与 projects/styles/archives 落在同一数据根下（桌面版沿用 NOVEL_DATA_ROOT）。

import { promises as fs } from "fs";
import path from "path";
import { dataRoot } from "../storage";
import type { ChangeProposal, ChatSession } from "./types";

const CHAT_DIR = path.join(dataRoot(), "chats");
const PROPOSAL_DIR = path.join(dataRoot(), "proposals");

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

// ---- ChatSession 存储（§3.6） ---------------------------------------------

async function readChat(id: string): Promise<ChatSession | null> {
  try {
    const raw = await fs.readFile(path.join(CHAT_DIR, `${safeId(id)}.json`), "utf-8");
    return JSON.parse(raw) as ChatSession;
  } catch {
    return null;
  }
}

async function writeChat(session: ChatSession): Promise<ChatSession> {
  await fs.mkdir(CHAT_DIR, { recursive: true });
  session.updatedAt = Date.now();
  await fs.writeFile(
    path.join(CHAT_DIR, `${safeId(session.id)}.json`),
    JSON.stringify(session, null, 2),
    "utf-8"
  );
  return session;
}

// 会话 Repository：镜像 ProjectRepository 的 ownerId 语义（接缝③）。
// 当前文件系统实现忽略 ownerId（本地单用户）；上云时按 ownerId 隔离。
export interface SessionRepository {
  get(ownerId: string, id: string): Promise<ChatSession | null>;
  save(ownerId: string, session: ChatSession): Promise<ChatSession>;
  list(ownerId: string): Promise<ChatSession[]>;
  delete(ownerId: string, id: string): Promise<void>;
}

export class FileSystemSessionRepository implements SessionRepository {
  async get(_ownerId: string, id: string): Promise<ChatSession | null> {
    return readChat(id);
  }

  async save(ownerId: string, session: ChatSession): Promise<ChatSession> {
    if (!session.ownerId) session.ownerId = ownerId;
    return writeChat(session);
  }

  async list(_ownerId: string): Promise<ChatSession[]> {
    await fs.mkdir(CHAT_DIR, { recursive: true });
    const files = await fs.readdir(CHAT_DIR);
    const out: ChatSession[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        out.push(JSON.parse(await fs.readFile(path.join(CHAT_DIR, f), "utf-8")) as ChatSession);
      } catch {
        // skip unreadable/corrupt files
      }
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  }

  async delete(_ownerId: string, id: string): Promise<void> {
    try {
      await fs.unlink(path.join(CHAT_DIR, `${safeId(id)}.json`));
    } catch {
      // already gone
    }
  }
}

export const sessionRepository: SessionRepository = new FileSystemSessionRepository();

// ---- 待确认写操作提案存储（§3.5 Human-in-the-loop 跨轮桥接） -----------------

// 落库的提案：除对客户端可见的 ChangeProposal 外，另存执行所需的租户/作品上下文。
export interface StoredProposal {
  proposal: ChangeProposal;
  ownerId: string;
  projectId?: string;
  createdAt: number;
}

export async function savePendingProposal(p: StoredProposal): Promise<void> {
  await fs.mkdir(PROPOSAL_DIR, { recursive: true });
  await fs.writeFile(
    path.join(PROPOSAL_DIR, `${safeId(p.proposal.id)}.json`),
    JSON.stringify(p, null, 2),
    "utf-8"
  );
}

export async function getPendingProposal(id: string): Promise<StoredProposal | null> {
  try {
    const raw = await fs.readFile(path.join(PROPOSAL_DIR, `${safeId(id)}.json`), "utf-8");
    return JSON.parse(raw) as StoredProposal;
  } catch {
    return null;
  }
}

export async function deletePendingProposal(id: string): Promise<void> {
  try {
    await fs.unlink(path.join(PROPOSAL_DIR, `${safeId(id)}.json`));
  } catch {
    // already gone
  }
}
