# 墨章 · 本地对话 Agent 系统规范

> 适配版规范。目标：在**现有墨章工作流**之上，长出一个**可视化对话 Agent 外壳**，把新书初始化、续写、微调、检索问答等能力交给一个**本地运行**的工具调用 Agent。
>
> 交付形态：Windows 桌面 App（Electron 单 exe）不变；架构改为**客户端 ↔ 本地服务端**形态，并预留上云接缝，但**当前不上云、不引入 Python**。
>
> 本规范可直接作为 Qoder 的系统指令 / 开发驱动文档使用。

---

## 0. 与旧版 MD 的关键差异（务必先读）

之前那份 MD 假设"小说逻辑已沉淀在一个可调用的后台服务里，通过 4 个标准接口即可驱动"。**这与真实架构不符**：

- 墨章的编排原本在前端 React 里，`/api/generate/*` 只是**无状态薄层**（拼提示词 + 转发流式 LLM）；
- 数据是**纯 JSON 文件**（`data/projects/*.json`），无 SQLite、无向量库；
- 检索是**确定性多因子匹配**（`lib/retrieval.ts`），不是 Chroma 向量检索；
- 模型密钥在**前端**（localStorage），每次请求塞进 body；
- 流式是 `text/plain` 分块，不是 SSE `data:` 帧。

本规范**不推翻**这些事实，而是**在其之上加一层 Agent**，并复用现有一切能力。技术栈保持 **全栈 TypeScript / Next.js**。

---

## 1. 架构总览

```
┌─────────────────────────────┐        ┌───────────────────────────────────────┐
│  客户端 (Client Shell)       │        │  本地服务端 (Next.js Server)            │
│  - Electron 窗口 / 浏览器 UI  │  HTTP  │  - /api/agent/chat  ← 新增，Agent 循环  │
│  - 对话面板 + 现有工作流 UI   │ ─────▶ │  - /api/generate/*  ← 现有生成端点       │
│  - apiBase（默认本地端口）    │        │  - /api/projects*   ← 现有数据端点       │
│  - ApiConfig（模型密钥）      │        │  - lib/ 工具函数（检索/校验/存储）      │
└─────────────────────────────┘        └───────────────────────────────────────┘
                                                        │
                                                        ▼
                                          data/  (JSON 单档 · Repository 抽象后)
```

- **客户端**只认一个 `apiBase`：默认指向本地内置服务（`http://127.0.0.1:<port>`），未来上云只改这个值。
- **本地服务端**新增 `/api/agent/chat` 作为 Agent 运行时；Agent 的工具直接调用 `lib/` 内的纯函数与存储（服务端进程内，无需 HTTP 往返）。
- **数据**仍是 JSON 单档，但收敛到 `ProjectRepository` 接口之后（见 §2）。

---

## 2. 云就绪接缝（现在就埋，不上云）

以下接缝**必须在写 Agent 之前或同批完成**，让未来上云是"加实现 + 换配置"，而非重写。

| # | 接缝 | 现在的实现 | 未来上云的替换点 | 落点文件 |
|---|---|---|---|---|
| ① | **API Base URL** | 客户端 fetch 统一走 `apiBase`，默认本地端口 | 改为云端域名 | `lib/client.ts` |
| ② | **存储 Repository** | 定义 `ProjectRepository` 接口，文件系统实现 | 换 DB/对象存储实现 | 新增 `lib/repository.ts`，改 `lib/storage.ts` |
| ③ | **ownerId 租户维度** | 所有数据访问带 `ownerId`，本地固定 `"local"` | 换真实登录用户 id + 过滤 | Repository 接口签名 |
| ④ | **配置 / 密钥 provider** | 集中一个函数拿生效 `ApiConfig`（现读 localStorage 并随请求传入） | 换服务端每用户密钥库 | 新增 `lib/config-provider.ts` |
| ⑤ | **Auth 中间件接缝** | no-op：直接放行并注入 `ownerId="local"` | 换真实鉴权 | 新增 `lib/auth.ts` |

**接缝②③ 参考签名（示意，不改变现有 JSON 行为）：**

```ts
// lib/repository.ts
export interface ProjectRepository {
  list(ownerId: string): Promise<Project[]>;
  get(ownerId: string, id: string): Promise<Project | null>;
  save(ownerId: string, project: Project): Promise<Project>;
  delete(ownerId: string, id: string): Promise<void>;
}
// 当前：FileSystemProjectRepository —— 内部沿用 lib/storage.ts 现有逻辑，
// ownerId="local" 时路径与今天完全一致（保证旧数据零迁移）。
```

> 约束：接缝改造**不得改变**现有单用户桌面的落盘位置与文件格式，`ownerId="local"` 必须命中今天的 `data/projects/*.json`。

---

## 3. 本地 Agent 核心设计（本规范重点）

### 3.1 运行时选型

- **Agent 框架：Vercel AI SDK（`ai` 包）**。理由：与 Next/React 深度集成，原生支持 tool calling + 流式 + `useChat` 前端钩子；纯 TS，不破坏单 exe 交付。
- **不选 Python / LangGraph(Py) / Chroma**。若未来需要多步状态图，再评估 **LangGraph.js**，但起步用 AI SDK 的工具循环足够。
- **模型**：沿用 `ApiConfig`（OpenAI 兼容，DeepSeek 等），密钥仍由客户端传入（见接缝④）。Agent 主循环与工具内部生成都用 `lib/llm.ts` 的 `streamChat` / `completeChat`。

### 3.2 Agent 运行位置

- 新增 **`app/api/agent/chat/route.ts`**：Agent 循环**跑在服务端**。
- 服务端跑的好处：工具可直接调用 `lib/storage`、`lib/retrieval`、`lib/reconcile` 的纯函数，无 HTTP 往返；密钥不额外暴露。
- 请求体（客户端 → Agent）：
  ```ts
  {
    config: ApiConfig,          // 模型与密钥（接缝④）
    messages: ChatMessage[],    // 多轮对话历史
    projectId?: string,         // 当前作品上下文（可空 = 尚未选书）
    confirmations?: ConfirmToken[] // 已确认的待执行写操作（见 3.5）
  }
  ```
- 响应：**流式**（沿用 `text/plain` 分块或升级为 AI SDK 的 data stream），逐块回传助手文本 + 工具调用事件。

### 3.3 Agent 状态原则（云就绪关键）

- **服务端 Agent 循环保持无状态**：不在进程内存里存会话状态。
- 会话历史、Agent 中间状态一律**经 Repository 落存储**（本地即 JSON，未来即 DB）。
- 多轮所需上下文由**客户端携带 messages + projectId** 传入（与现有 `/api/generate/*` 的"上下文由调用方组装"一致）。

### 3.4 工具清单（Tools）—— 全部映射到真实符号

工具在服务端定义，内部调用现有函数/端点。**不重写小说逻辑**。

**A. 数据 / 项目（映射 `lib/storage.ts` 经 Repository）**
| 工具 | 作用 | 底层 |
|---|---|---|
| `list_projects` | 列出作品摘要 | `repo.list(ownerId)` → `toSummary` |
| `get_project` | 读取整本作品 | `repo.get(ownerId, id)` |
| `create_project` | 新建空作品 | `emptyProject` + `repo.save` |
| `save_project`\* | 覆盖保存整本 | `repo.save`（\*写操作，需确认，见 3.5） |
| `delete_project`\* | 删除作品 | `repo.delete`（\*高危，需确认） |

**B. 生成 / 工作流（映射 `/api/generate/*`，内部复用其 prompt 构造 + `streamChat`）**
| 工具 | 作用 | 底层端点 |
|---|---|---|
| `generate_bible` | 生成故事设定集（立意/世界观/人物） | `/api/generate/bible` |
| `generate_volumes` | 生成分卷脉络 | `/api/generate/volumes` |
| `generate_volume` | 生成单卷细节 | `/api/generate/volume` |
| `generate_chapter_outline` | 生成章节脉络 | `/api/generate/chapter-outline` |
| `generate_chapter`\* | 生成/续写正文（写入草稿需确认） | `/api/generate/chapter` |
| `digest_chapter` | 成稿后提炼摘要 + 抽取 codex/伏笔更新 | `/api/generate/digest` |
| `generate_recap` | 滚动卷摘要 / 全书 storySoFar | `/api/generate/recap` |
| `reconcile`\* | 上游重生后的全链一致性校正 | `/api/generate/reconcile` |

> `generate_chapter` 入参契约（已核实）：`config, setup, bible, volume, chapter, prevChapter, ctx?, globalNo?, direction?, prompts?, nextChapter?`。其中 `ctx` 由 `buildChapterContext` 组装——Agent 应先调用检索工具拿 `ctx` 再生成。

**C. 记忆 / 检索（映射 `lib/retrieval.ts` 纯函数，服务端进程内直调）**
| 工具 | 作用 | 底层 |
|---|---|---|
| `build_chapter_context` | 为某章组装三层记忆 + 相关设定 + 活跃伏笔 | `buildChapterContext(project, chapterId)` |
| `query_codex` | 按文本检索相关世界档案条目 | `selectRelevantCodex(codex, text, ...)` |
| `apply_digest`\* | 把 digest 折回 codex/伏笔/摘要 | `applyDigest`（写操作，需确认） |
| `apply_reconcile`\* | 折回一致性校正（不改已写正文） | `applyReconcile`（写操作，需确认） |

**D. 拆书学（映射 style / archive 端点，供"二创开新书"）**
| 工具 | 作用 | 底层端点 |
|---|---|---|
| `analyze_style` | 拆文风 → 文风卡 | `/api/style-analyze` |
| `analyze_archive` | 拆设定 → 作品档案 | `/api/archive-analyze` |
| `list_style_cards` / `list_archives` | 列举缓存 | `/api/styles`、`/api/archives` |

### 3.5 Human-in-the-loop（写操作安全基线，强制）

小说数据不可被 Agent 静默改写。工具分两类：

- **只读 / 生成到草稿**（无 \*）：Agent 可自由调用（读取、检索、生成候选文本）。
- **写操作**（带 \*：`save_project`/`delete_project`/`apply_digest`/`apply_reconcile`/正文落库）：
  1. Agent **不直接提交**，而是产出一份**变更提案**（changeSummary + 目标 diff）；
  2. 通过流式事件把提案回传客户端，UI 展示"确认 / 取消"；
  3. 用户确认后，客户端在下一轮把 `confirmations` 回传，服务端才真正落库。

> 复用现有资产：`reconcile.ts` 的 `changeSummary` / `staleProse` 机制、以及"重生成后全链一致性"UI，正是这套确认流的地基。**已写正文永不自动覆盖**（沿用 `reconcile` 的既定原则）。

### 3.6 对话会话数据模型

新增会话实体，经 Repository 存储（本地 JSON，云端 DB）：

```ts
interface ChatSession {
  id: string;
  ownerId: string;          // 接缝③
  projectId?: string;       // 绑定的作品（可空）
  title: string;
  messages: ChatMessage[];  // role/content/toolCalls
  createdAt: number; updatedAt: number;
}
interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: { name: string; args: unknown; result?: unknown }[];
}
```

---

## 4. 未来功能的接入约定（分阶段，勿一次做完）

### 阶段一 · Agent 外壳（先做）
- 完成接缝 ①②③④⑤ 的最小实现；
- 新增 `/api/agent/chat` + A/B/C 组核心工具；
- 客户端加对话面板（`useChat`），能"用自然语言驱动：新建书 → 生成设定 → 生成脉络 → 续写"，写操作走确认流。

### 阶段二 · 酒馆式角色卡对话
- **复用 `CodexEntry`（category="人物"）作为角色卡**：`name/aliases/summary/status/events` 即人设与状态时间线。
- persona 组装 = 选定角色的 codex 条目 + `selectRelevantCodex` 注入的相关世界档案（世界书/lorebook 等价物）+ 该书 `bible.tone`。
- 新增 `roleplay_chat` 模式：多轮对话历史存 `ChatSession`（`projectId` 绑定作品），**不污染正文数据**。
- 不需要向量库；确定性检索已提供 lorebook 级注入。

### 阶段三 · 自主编辑 skill
- 用工具循环让 Agent 自主编排：`build_chapter_context` → `generate_chapter`（带 direction）→ `digest_chapter` → `reconcile` → 产出变更提案；
- **强制 Human-in-the-loop**（§3.5）：每个写操作都要人确认；
- 可选：把常用编排固化为"技能脚本"（预置 system 提示 + 工具白名单）。

### 阶段四（按需，触发才做）
- 会话量大 → 引入 `better-sqlite3`（仍纯 Node，不换语言）；
- 需要语义检索 → 加**本地嵌入可选增强层**（如 transformers.js），**不替换**确定性检索这一记忆真源；
- 决定上云 → 加 Repository 的 DB 实现 + 真实 Auth + 服务端密钥库 + 换部署目标；桌面版保留为"本地模式"。

---

## 5. 建议的新增 / 改动文件

| 文件 | 动作 | 说明 |
|---|---|---|
| `lib/repository.ts` | 新增 | `ProjectRepository` 接口 + `FileSystemProjectRepository` |
| `lib/storage.ts` | 改 | 内部被 FS 实现复用；对外逐步走 Repository |
| `lib/config-provider.ts` | 新增 | 集中获取生效 `ApiConfig` |
| `lib/auth.ts` | 新增 | no-op 鉴权，注入 `ownerId="local"` |
| `lib/agent/tools.ts` | 新增 | 工具注册表（§3.4） |
| `lib/agent/runtime.ts` | 新增 | Agent 循环、确认流编排 |
| `app/api/agent/chat/route.ts` | 新增 | Agent HTTP 入口，流式 |
| `lib/client.ts` | 改 | 引入 `apiBase`，fetch 统一走它 |
| `components/AgentChat.tsx` | 新增 | 对话面板 UI |

---

## 6. 硬约束与非目标

**硬约束**
- 全栈 TypeScript；**不引入 Python**。
- 保持 **Electron 单 exe** 本地交付；Agent 与新功能不得破坏该能力。
- **确定性检索**是记忆真源，向量仅可选增强层。
- 已写正文**永不自动覆盖**；一切写操作经 Human-in-the-loop 确认。
- 接缝改造对现有桌面用户**零数据迁移**（`ownerId="local"` 命中今天的文件路径）。

**非目标（当前阶段不做）**
- 不部署云、不加 Postgres/Redis/K8s。
- 不做真实登录 / 多租户鉴权（只留接缝）。
- 不做多人实时协同（CRDT/OT）。
- 不引入 Chroma / 向量数据库。

---

## 7. 验收标准（阶段一）

1. 客户端 `apiBase` 可配置，默认本地端口，切换到任意 URL 后请求正确改向。
2. 所有数据读写经 `ProjectRepository`，`ownerId="local"` 下与改造前落盘完全一致（旧作品可正常打开）。
3. 对话面板中，用自然语言可完成：新建作品 → 生成设定集 → 生成分卷脉络 → 续写某章草稿。
4. 每个写操作（保存/删除/折回/正文落库）都弹出变更提案并等待确认，取消则不落库。
5. 桌面版仍为单 exe，双击可用，数据位置沿用现有自定义逻辑。
