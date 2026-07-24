# TASKBOARD · 墨章本地 Agent（阶段一）多会话并行开发看板

> 主会话维护本文件。两个子会话每完成一段就回填「进度」栏并 commit。
> 依据文档：[墨章·本地对话 Agent 系统规范](./墨章对话Agent系统规范.md)（下称「规范」）。

---

## 0. 协作模型

| 角色 | Quest | 工作树目录 | 分支 | 职责 |
|------|-------|-----------|------|------|
| 主会话 | Quest 1 | `E:/novel-workflow` | `main` | 拆任务、维护契约与本看板、review、合并、跑验收 §7 |
| Sub A（后端/Agent） | Quest 2 | `E:/nw-agent-be` | `feat/agent-backend` | 接缝①~⑤实现 + 存储收敛 + Agent 工具/运行时 + `/api/agent/chat` |
| Sub B（客户端/UX） | Quest 3 | `E:/nw-agent-fe` | `feat/agent-ui` | 对话面板 + `useChat` + 变更提案确认流 UI + `apiBase` 接入 |

**协调纪律**
- 两个子分支都从 `main` 分出，共享已冻结的契约文件（见 §2）。
- **契约文件（`lib/repository.ts`、`lib/agent/types.ts`）只能由主会话在 `main` 上改**；需变更时先改 main → 通知两个子会话 `git rebase main`。
- 子会话不跨界改对方目录；确需协同的接口变更走主会话。
- 每完成一节，在本文件对应「进度」打勾并 commit（分支内）。

**并行运行环境（本项目约定）**
- 每个 worktree 不继承 `node_modules` / `.next`，进目录先 `npm install`。
- 同时跑 dev 要错开端口：Sub A 用 `$env:PORT=3001`，Sub B 用 `$env:PORT=3002`。
- 如需共享同一份作品数据：两边设 `NOVEL_DATA_ROOT` 指向同一物理路径。

---

## 1. 阶段 0（主会话已完成 ✅）

- [x] 冻结存储接缝契约：`lib/repository.ts`（`ProjectRepository` / `LOCAL_OWNER` / `FileSystemProjectRepository`）
- [x] 冻结 Agent 对话契约：`lib/agent/types.ts`（`ChatSession` / `ChatMessage` / `ChangeProposal` / `ConfirmToken` / `AgentChatRequest` / `AgentStreamEvent`）
- [x] 建两个 worktree + 分支
- [x] 本看板

---

## 2. 冻结的契约（双方以此为准）

**存储（接缝②③）— `lib/repository.ts`**
```ts
interface ProjectRepository {
  list(ownerId: string): Promise<Project[]>;
  get(ownerId: string, id: string): Promise<Project | null>;
  save(ownerId: string, project: Project): Promise<Project>;
  delete(ownerId: string, id: string): Promise<void>;
}
// LOCAL_OWNER = "local"；projectRepository 为默认单例。
```

**Agent 对话 — `lib/agent/types.ts`**
- 请求体 `AgentChatRequest = { config, messages, projectId?, confirmations? }`
- 流式事件 `AgentStreamEvent`：`text | tool_call | tool_result | proposal | done | error`
- 写操作提案 `ChangeProposal` + 确认 `ConfirmToken`（Human-in-the-loop，规范 §3.5）

> 约定：`/api/agent/chat` 以分块流逐条回传 `AgentStreamEvent`（JSON 行）；客户端按 `type` 分发。序列化细节由 Sub A 决定并在此补记，Sub B 据此解析。

---

## 3. Sub A · 后端 / Agent（`feat/agent-backend`）

参照规范 §2 / §3 / §5。归属文件：`lib/repository.ts`（实现加固）、`lib/config-provider.ts`、`lib/auth.ts`、`lib/storage.ts`（收敛）、`lib/agent/tools.ts`、`lib/agent/runtime.ts`、`app/api/agent/chat/route.ts`。

- [ ] 接缝①：`lib/client.ts` 的 fetch 统一走 `apiBase`（与 Sub B 协调，见下方边界说明）
- [ ] 接缝②：`app/api/projects*` 与工具层统一经 `projectRepository` 访问；`ownerId="local"` 落盘与今天一致
- [ ] 接缝④：`lib/config-provider.ts` 集中获取生效 `ApiConfig`
- [ ] 接缝⑤：`lib/auth.ts` no-op 鉴权，注入 `ownerId="local"`
- [ ] `lib/agent/tools.ts`：注册 A/B/C 组工具（规范 §3.4），映射真实符号
- [ ] `lib/agent/runtime.ts`：Agent 工具循环 + 写操作确认流编排（产出 `ChangeProposal`，凭 `ConfirmToken` 落库）
- [ ] `app/api/agent/chat/route.ts`：流式回传 `AgentStreamEvent`
- [ ] `ChatSession` 经 Repository 落存储（新增会话存储实现）

**进度 / 备注：**
- （在此补记流式序列化格式，供 Sub B 对齐）

---

## 4. Sub B · 客户端 / UX（`feat/agent-ui`）

参照规范 §3.5 / §5。归属文件：`components/AgentChat.tsx`、对话面板接入现有三栏外壳、变更提案确认 UI。**后端未就绪前对着 §2 契约用 mock 流开发。**

- [ ] `components/AgentChat.tsx`：对话面板（消息列表 + 输入框 + 流式渲染）
- [ ] 解析 `AgentStreamEvent`：文本增量、工具调用/结果展示
- [ ] 变更提案确认流：收到 `proposal` 事件渲染 changeSummary + diff，提供「确认/取消」，下一轮回传 `confirmations`
- [ ] 接入现有 AppShell / AgentPanel 位（不破坏三栏外壳）
- [ ] 与 Sub A 约定 `apiBase` 后，请求指向 `/api/agent/chat`

**进度 / 备注：**
- （在此补记 mock 契约用法 / 联调结论）

---

## 5. 边界与协同点（易冲突处，需主会话仲裁）

- `lib/client.ts`（接缝① apiBase）两边都会碰：**由 Sub A 落地 `apiBase` 基础设施**，Sub B 只消费。
- `lib/types.ts`：如需新增字段，走主会话在 `main` 改后同步。
- 流式事件序列化格式：Sub A 定义并在 §2/§3 备注，Sub B 据此实现解析。

---

## 6. 合并顺序（主会话）

1. Sub A 先合（后端契约实现是地基）→ `main`
2. Sub B rebase 最新 `main` → 联调 → 合并
3. 主会话跑阶段一验收（§7）

---

## 7. 阶段一验收（对齐规范 §7）

- [ ] `apiBase` 可配置，默认本地端口，切换 URL 后请求正确改向
- [ ] 数据读写经 `ProjectRepository`，`ownerId="local"` 落盘与改造前一致（旧作品可正常打开）
- [ ] 对话面板可用自然语言完成：新建作品 → 生成设定集 → 生成分卷脉络 → 续写某章草稿
- [ ] 每个写操作弹出变更提案并等待确认，取消则不落库
- [ ] 桌面版仍为单 exe，数据位置沿用现有自定义逻辑
