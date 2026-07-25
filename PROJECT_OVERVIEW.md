# 墨章 · Novel Atelier —— 项目技术总览

> 面向「百万字长篇小说」的本地优先 AI 创作工作流桌面应用。
> 本文档面向后续开发者及其 AI Agent，帮助快速理解项目全貌、接手开发。

---

## 1. 项目定位与核心理念

**单人本地桌面应用**，接入任意 OpenAI 兼容大模型接口，提供从立意到完稿的全流程 AI 辅助。

**核心要解决的难题**：上下文长度有限时，如何让百万字保持前后连贯、人物/设定不崩、伏笔有始有终、且读起来不像 AI。

**设计原则**：
- 本地优先：数据全部在用户电脑上，密钥仅存浏览器 localStorage
- Human-in-the-loop：所有写操作需用户确认方可落库
- 云就绪接缝：鉴权/存储/配置层预留多租户接口，但当前 ownerId="local"
- 即用即实、未用即留：已实现的功能完整可用；规划中的功能仅保留类型接口

---

## 2. 技术栈

| 层面 | 选型 | 备注 |
|------|------|------|
| 框架 | Next.js 15.5 (App Router) | `output: "standalone"` 供 Electron 内嵌 |
| UI | React 19 | 严格模式 |
| 语言 | TypeScript 5 (strict) | 路径别名 `@/*` |
| 样式 | Tailwind CSS v4 + CSS 变量设计系统 | 深墨蓝+朱砂红主题 |
| 桌面壳 | Electron 33 + electron-builder 25 | NSIS 安装程序 |
| 数据存储 | 纯 JSON 文件 (`data/` 目录) | 无数据库依赖 |
| 模型接入 | OpenAI 兼容 `/chat/completions` | SSE 流式 + JSON 非流式 |
| 导出 | epub-gen-memory (纯 JS EPUB) | 无 native addon |
| 构建 | next build → standalone → electron-builder | CI: GitHub Actions |

**生产依赖**（极简）：`next` / `react` / `react-dom` / `epub-gen-memory`

---

## 3. 目录结构

```
novel-workflow/
├── app/                          # Next.js App Router 页面与 API
│   ├── page.tsx                  # 首页「书房」
│   ├── globals.css               # 设计系统
│   ├── settings/                 # 多模型 API 配置管理
│   ├── style/                    # 拆书工坊（学文风/拆设定）
│   ├── project/[id]/             # 作品工作区
│   ├── agent/                    # Agent 独立入口
│   ├── new/ | continue/ | shelf/ # 新建/续写/书架
│   └── api/
│       ├── agent/chat/           # Agent 对话（NDJSON 流）
│       ├── agent/roleplay/       # 角色对话（NDJSON 流）
│       ├── generate/             # 8 个生成端点
│       ├── projects/             # 作品 CRUD
│       ├── export/               # EPUB/MD/TXT 导出
│       ├── history/              # 章节版本历史
│       ├── queue/                # 任务队列
│       ├── style-analyze/        # 文风分析
│       ├── styles/               # 文风卡库
│       ├── archive-analyze/      # 设定分析
│       ├── archive-reduce/       # 档案归并
│       └── archives/             # 档案卡库
├── components/                   # 19 个 React 组件
│   ├── StepOutline.tsx           # 三步立意向导（最大组件 54KB）
│   ├── StepWriting.tsx           # 逐章写作面板
│   ├── AgentChat.tsx             # Agent 对话面板
│   ├── RoleplayChat.tsx          # 角色对话（1v1 + 多角色轮转）
│   ├── ExportDialog.tsx          # 导出格式选择
│   ├── HistoryPanel.tsx          # 版本历史 + diff + 回滚
│   ├── TaskQueue.tsx             # 任务队列面板
│   ├── CodexPanel.tsx            # 设定库 + 伏笔表
│   ├── SkillPicker.tsx           # 技能选择器
│   ├── PromptLibrary.tsx         # 提示词库
│   ├── AppShell.tsx              # 三栏布局外壳
│   └── ...                       # TopBar, Workspace 等
├── lib/                          # 核心业务逻辑（纯函数 + 类型）
│   ├── types.ts                  # 全部数据模型（单一来源）
│   ├── llm.ts                    # LLM 流式/非流式调用
│   ├── prompts.ts                # 所有提示词构造（41KB）
│   ├── retrieval.ts              # 多因子检索 + 分层前情
│   ├── reconcile.ts              # 重生成后一致性统一
│   ├── style.ts                  # 拆书学文风
│   ├── archive.ts                # 拆书学设定
│   ├── storage.ts                # 文件读写
│   ├── repository.ts             # ProjectRepository 接口
│   ├── config-provider.ts        # 生效配置获取
│   ├── auth.ts                   # 鉴权接缝（当前 no-op）
│   ├── client.ts                 # 客户端 fetch + 配置档
│   ├── future-stubs.ts           # 未来功能接口预留
│   ├── agent/                    # Agent 系统（7 文件）
│   │   ├── types.ts              # 契约类型
│   │   ├── runtime.ts            # 工具循环 + 确认流
│   │   ├── tools.ts              # 17+4 个注册工具
│   │   ├── skills.ts             # 6 个内置技能
│   │   ├── useChat.ts            # 客户端 hook
│   │   ├── session-store.ts      # 会话持久化
│   │   └── mockStream.ts         # Mock 传输
│   ├── roleplay/                 # 角色对话（4 文件）
│   │   ├── types.ts              # 多角色类型
│   │   ├── persona.ts            # 人设组装
│   │   ├── runtime.ts            # 1v1 + 多角色运行时
│   │   └── useRoleplay.ts        # 客户端 hook
│   ├── export/                   # 导出模块（5 文件）
│   │   ├── types.ts / index.ts
│   │   ├── epub.ts / markdown.ts / txt.ts
│   ├── history/                  # 版本历史（3 文件）
│   │   ├── types.ts / store.ts / diff.ts
│   └── queue/                    # 任务队列（4 文件）
│       ├── types.ts / store.ts / runner.ts / presets.ts
├── electron/
│   ├── main.js                   # Electron 主进程
│   └── preload.js                # contextBridge IPC
├── scripts/
│   ├── prepare-standalone.mjs    # 构建后补齐静态资源
│   └── generate-icon.mjs         # 应用图标生成
├── data/                         # 运行时数据（gitignored）
│   ├── projects/                 # 作品 JSON
│   ├── styles/                   # 文风卡缓存
│   ├── archives/                 # 档案卡缓存
│   ├── chats/                    # Agent 会话
│   ├── proposals/                # 待确认提案
│   ├── roleplay/                 # 角色对话会话
│   ├── history/                  # 章节快照
│   └── queue/                    # 任务队列数据
├── build/                        # 构建资源（icon.ico）
├── .github/workflows/release.yml # CI 自动构建发布
├── package.json                  # 项目配置
├── tsconfig.json                 # TS strict 配置
└── next.config.mjs               # Next.js standalone 配置
```

---

## 4. 功能模块完整清单

### 4.1 创作核心流程

| 功能 | 入口 | 核心文件 |
|------|------|----------|
| 三步立意向导 | StepOutline.tsx | prompts.ts (buildBiblePrompt / buildVolumesPrompt / buildVolumeChaptersPrompt) |
| 逐章正文生成 | StepWriting.tsx | retrieval.ts + prompts.ts (buildChapterPrompt) |
| 连贯性检索 | 自动 (写章前) | retrieval.ts (selectRelevantCodex / buildChapterContext) |
| 分层滚动前情 | 自动 + 手动 | client.ts (generateRecap) → /api/generate/recap |
| 写后归档 (Digest) | 自动/手动 | /api/generate/digest → applyDigest |
| 一致性统一 | 重生成后 | reconcile.ts → /api/generate/reconcile |
| 去 AI 味 | setup.deAi=true | prompts.ts (deAiBlock) |
| 内容分级 | setup.rating | prompts.ts (RATING_GUIDANCE) |
| 方向驱动重生 | 带方向文本重生 | prompts.ts 注入 + recordPromptEntry 入库 |
| 提示词库 | PromptLibrary.tsx | types.ts (PromptEntry) + enabledPrompts |

### 4.2 拆书工坊

| 功能 | 路由 | 核心文件 |
|------|------|----------|
| 拆书学文风 | /style (Tab1) | style.ts + /api/style-analyze |
| 拆书学设定 | /style (Tab2) | archive.ts + /api/archive-analyze + /api/archive-reduce |
| 文风卡库 | /api/styles/ | data/styles/<hash>.json |
| 档案卡库 | /api/archives/ | data/archives/<hash>.json |
| 二创开新书 | ArchiveResult.tsx | archive.ts (seedProjectFromArchive) |

### 4.3 Agent 系统

| 功能 | 路由/组件 | 核心文件 |
|------|-----------|----------|
| 对话 Agent | /api/agent/chat | agent/runtime.ts (工具循环) |
| 17+4 工具 | - | agent/tools.ts (A/B/C/D 四组) |
| 技能层 (Skill) | SkillPicker.tsx | agent/skills.ts (6 个内置技能) |
| Human-in-the-loop | ChangeSummary.tsx | ChangeProposal + ConfirmToken |
| 生成缓存→落库 | - | runtime.ts (generated 缓存 + fromGenerated) |

**工具分组**：
- A 组（项目管理）：list_projects / get_project / create_project / save_project / set_project_setup
- B 组（生成候选）：generate_bible / generate_volumes / generate_volume / generate_chapter_outline / generate_chapter / build_chapter_context / apply_digest / apply_reconcile
- C 组（应用）：apply_digest / apply_reconcile / generate_recap / get_codex
- D 组（拆书学）：analyze_style / analyze_archive / list_style_cards / list_archives

**内置技能**：write-chapter / write-and-digest / plan-volumes / plan-volume-detail / reconcile-downstream / generate-recap

### 4.4 角色对话（酒馆式 Roleplay）

| 功能 | 说明 |
|------|------|
| 1v1 对话 | 选角 → 沉浸式多轮对话，角色以第一人称回应 |
| 多角色轮转 | 多选角色 → round-robin / manual / narrator-driven 三种模式 |
| 人设组装 | assemblePersona: 角色人设 + 世界书检索 + bible.tone + 在场其他角色 |
| 会话持久化 | data/roleplay/<sessionId>.json |

**轮转模式**：
- `round-robin`：按 turnOrder 自动轮转
- `manual`：用户指定下一位发言者（targetCharacterId）
- `narrator-driven`：旁白驱动场景切换

### 4.5 章节版本历史

| 功能 | 说明 |
|------|------|
| 自动快照 | save_project 落库前对被修改章节拍快照 |
| 快照存储 | data/history/{projectId}/{chapterId}/{timestamp}.json |
| 行级 Diff | 自实现 LCS 算法，返回增/删/改行数组 |
| 一键回滚 | POST /api/history (action=restore) |
| 保留策略 | 每章最多 50 个快照，FIFO |

### 4.6 导出

| 格式 | 实现 | 备注 |
|------|------|------|
| EPUB | epub-gen-memory (纯 JS) | 含卷/章结构 |
| Markdown | 纯字符串拼接 | 含 YAML front-matter |
| TXT | 纯文本 | 最简格式 |

**交付方式**：
- Web 模式：浏览器 Blob 下载
- Electron 模式：检测 `window.electronAPI` → 原生保存对话框（IPC: `save-file`）

### 4.7 任务队列 + 断点续跑

| 功能 | 说明 |
|------|------|
| Step 序列化 | 每个任务分解为有序 TaskStep[] |
| 指数退避重试 | 1s/2s/4s，最多 3 次 |
| Checkpoint | 每 step 完成后持久化 completedSteps + lastResult |
| 暂停/恢复 | AbortSignal + status 切换 |
| SSE 推送 | GET /api/queue/[id]?stream=true |
| 预设模板 | batchWriteChapters / batchDigest / fullPipeline |

---

## 5. API 路由表

| 路由 | 方法 | 格式 | 作用 |
|------|------|------|------|
| `/api/projects` | GET/POST | JSON | 作品列表/新建 |
| `/api/projects/[id]` | GET/PUT/DELETE | JSON | 单作品 CRUD |
| `/api/agent/chat` | POST | NDJSON 流 | Agent 对话 |
| `/api/agent/roleplay` | POST | NDJSON 流 | 角色对话 |
| `/api/generate/bible` | POST | JSON | 故事设定集 |
| `/api/generate/volumes` | POST | JSON | 分卷规划 |
| `/api/generate/volume` | POST | JSON | 单卷展开 |
| `/api/generate/chapter-outline` | POST | JSON | 重生章脉络 |
| `/api/generate/chapter` | POST | text/plain 流 | 正文生成 |
| `/api/generate/digest` | POST | JSON | 章节归档 |
| `/api/generate/recap` | POST | JSON | 前情梳理 |
| `/api/generate/reconcile` | POST | JSON | 一致性统一 |
| `/api/export` | GET | binary | 导出 EPUB/MD/TXT |
| `/api/history` | GET/POST | JSON | 版本快照/回滚 |
| `/api/queue` | GET/POST/DELETE | JSON | 任务队列 CRUD + start/pause |
| `/api/queue/[id]` | GET | JSON/SSE | 单任务状态/进度流 |
| `/api/style-analyze` | POST | JSON | 文风分析 |
| `/api/styles` | GET | JSON | 文风卡库列表 |
| `/api/styles/[hash]` | GET/PUT | JSON | 文风卡缓存 |
| `/api/archive-analyze` | POST | JSON | 设定分析 |
| `/api/archive-reduce` | POST | JSON | 档案归并 |
| `/api/archives` | GET | JSON | 档案卡库列表 |
| `/api/archives/[hash]` | GET/PUT | JSON | 档案卡缓存 |

**通用约定**：
- 生成类接口设 `dynamic="force-dynamic"`, `maxDuration=600`
- API Key 由前端随请求体传入（字段 `config`），服务端不落盘
- Agent/Roleplay 使用 NDJSON（每行一个 JSON 对象 + `\n`），末尾必有 `{"type":"done"}`

---

## 6. 数据模型概要（`lib/types.ts`）

```typescript
Project {
  id, ownerId, title, phase("outline"|"writing"),
  setup: ProjectSetup,      // 创作设定（题材/灵感/文风/分级/字数目标/deAi/styleCards）
  bible: StoryBible | null, // 故事圣经（logline/梗概/世界观/人物表）
  volumes: Volume[],        // 分卷 → 章节树
  codex: CodexEntry[],      // 设定库（人物/地点/物品/势力，带状态时间线）
  foreshadows: Foreshadow[],// 伏笔表（planted/reinforced/paid/abandoned）
  prompts: PromptEntry[],   // 本书提示词库
  storySoFar: string,       // 全书滚动梗概（顶层记忆）
}

Volume { index, title, arcSummary, plannedChapters, chapters: Chapter[] }
Chapter { id, index, title, synopsis, content, summary, status, wordCount }
CodexEntry { id, name, category, aliases[], summary, status, pinned, events[] }
```

> **改数据结构从 `lib/types.ts` 开始**；`storage.ts` 的 `normalizeProject` 负责为旧存档回填新字段。

---

## 7. 核心机制简述

| 机制 | 说明 | 关键文件 |
|------|------|----------|
| 连贯性检索 | 多因子打分（相关+新近+重要度）取 Top-N 设定条目 + 核心角色恒定注入 | retrieval.ts |
| 分层前情 | storySoFar（全书）→ arcSummary（本卷）→ 近4章 summary | retrieval.ts + recap |
| 写后归档 | 抽取摘要/设定更新/伏笔/冲突，同名合并回填 | digest + applyDigest |
| 去 AI 味 | 24 类反套路指令 + 黑名单词 + 负面清单 | prompts.ts (deAiBlock) |
| 确认流 | 写操作→ChangeProposal→等用户确认→apply落库 | agent/runtime.ts |
| 生成缓存 | generate_*产出存 ctx.generated→save_project 从缓存折叠 patch | agent/tools.ts |
| 版本快照 | apply前对修改章节拍快照→支持 diff/rollback | history/store.ts |

---

## 8. 未完成功能（规划中，尚未实现）

| 功能 | 现状 | 接口位置 |
|------|------|----------|
| 向量检索/语义召回 | 当前用子串+多因子打分，无 embedding | future-stubs.ts (EmbeddingProvider) |
| 多人物关系图谱 | 设定库有数据基础但无可视化 | future-stubs.ts (RelationEdge, buildRelationGraph) |
| 时间线视图 | CodexEntry.events 有数据但无独立视图 | future-stubs.ts (TimelineEvent, buildTimeline) |
| 服务端密钥加密存储 | 当前 Key 仅存浏览器 localStorage | future-stubs.ts (SecretStore) |
| SQLite 存储层 | 当前全 JSON 文件，大量作品时性能受限 | future-stubs.ts (SqliteRepository) |
| 代码签名 | NSIS 安装包未签名（SmartScreen 会拦截） | package.json (signAndEditExecutable: false) |
| asar 打包 | 当前 asar=false，文件可直接访问 | package.json (build.asar) |
| 多语言支持 | 仅中文界面 | — |
| 云同步/多端 | 架构已预留 ownerId 接缝但无实现 | auth.ts + repository.ts |

---

## 9. 预留接口详情（`lib/future-stubs.ts`）

所有未实现功能已定义类型接口和工厂函数（调用时抛 `NotImplemented`），未来启用时实现并替换导出即可：

```typescript
// 向量检索
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  search(query: string, topK: number): Promise<{ id: string; score: number }[]>;
}
function createEmbeddingProvider(): EmbeddingProvider;  // → transformers.js

// 关系图谱 + 时间线
interface RelationEdge { from: string; to: string; label: string; weight: number; }
interface TimelineEvent { chapter: number; codexId: string; event: string; timestamp: number; }
function buildRelationGraph(codex: CodexEntry[]): RelationEdge[];
function buildTimeline(codex: CodexEntry[]): TimelineEvent[];

// 服务端密钥库
interface SecretStore {
  get(ownerId: string, key: string): Promise<string | null>;
  set(ownerId: string, key: string, value: string): Promise<void>;
  delete(ownerId: string, key: string): Promise<void>;
}
function createSecretStore(): SecretStore;

// SQLite 存储
interface SqliteRepository {
  query<T>(sql: string, params?: any[]): Promise<T[]>;
  run(sql: string, params?: any[]): Promise<void>;
}
function createSqliteRepository(): SqliteRepository;
```

**扩展建议**：实现向量检索时只需替换 `retrieval.ts` 中 `selectRelevantCodex` 的打分部分，分层前情和核心条目恒定注入机制不受影响。

---

## 10. 开发指南

### 10.1 快速开始

```powershell
npm install
npm run dev          # http://localhost:3000（Web 开发）
npm run electron:dev # Electron 窗口开发（连 localhost:3000）
npm run app:build:win # 构建 Windows NSIS 安装包 → dist/
```

### 10.2 关键约定

| 约定 | 说明 |
|------|------|
| 数据单一来源 | 改数据模型先动 `lib/types.ts`，`storage.ts` 的 `normalizeProject` 负责旧数据回填 |
| 提示词集中 | 所有 prompt 在 `lib/prompts.ts`，与 UI 解耦 |
| 检索确定性 | `retrieval.ts` 无向量/无额外 LLM 调用，纯子串匹配+打分 |
| 函数式合并 | `patch((p) => updater(p))` 基于最新状态，勿用陈旧快照整体覆盖 |
| SSR 守卫 | 客户端组件用 `mounted` 延迟渲染，防水合不一致 |
| 无测试框架 | 验证以 `tsc --noEmit` + `npm run build` + 手动回归为准 |
| PowerShell | 不支持 `&&`，多命令用 `;` 分隔 |
| 端口错开 | 多实例开发时 `$env:PORT=3001` / `$env:PORT=3002` |

### 10.3 新增功能的典型流程

1. 在 `lib/types.ts` 添加数据类型
2. 在 `lib/<module>/` 实现核心逻辑
3. 在 `app/api/<route>/route.ts` 暴露 API
4. 在 `components/<Panel>.tsx` 实现 UI
5. 若涉及 Agent 工具：在 `lib/agent/tools.ts` 注册，在 `runtime.ts` 确认接入
6. `npx tsc --noEmit` + `npm run build` 验证通过

### 10.4 环境变量

| 变量 | 作用 | 默认值 |
|------|------|--------|
| `NOVEL_DATA_ROOT` | 数据存储根目录 | `<userData>/data`（Electron） |
| `PORT` | Next.js 监听端口 | 3000 |
| `ELECTRON_BUILDER_BINARIES_MIRROR` | electron-builder 二进制镜像 | npmmirror（`app:build:win`） |

### 10.5 构建与发布

```
npm run app:build:win
  → next build (standalone)
  → prepare-standalone (复制 .next/static + public/)
  → electron-builder --win (NSIS installer)
  → 产物: dist/墨章 Novel Atelier Setup x.y.z.exe (~145MB)
```

CI：推送 `v*` tag → GitHub Actions `windows-latest` 构建 → 上传到 Release。

### 10.6 已知构建注意事项

- **winCodeSign 符号链接**：Windows 无管理员权限时 darwin 符号链接创建失败。已通过 `signAndEditExecutable: false` 跳过 rcedit。若需恢复 exe 图标嵌入，需以管理员运行或启用开发者模式的符号链接权限。
- **GitHub 下载超时**：`app:build:win` 已配置 npmmirror 镜像（`ELECTRON_BUILDER_BINARIES_MIRROR`），国内网络可正常构建。

---

## 11. Electron 桌面架构

```
启动流程:
  app.whenReady()
  → resolveDataRoot() (env > data-location.json > <userData>/data)
  → buildMenu() (数据/编辑/视图菜单)
  → registerIpcHandlers() (save-file IPC)
  → createWindow()
    → 开发: loadURL(http://localhost:3000)
    → 生产: fork(.next/standalone/server.js, 随机端口) → waitForServer → loadURL

IPC 接口:
  save-file: 弹出原生保存对话框 + 写文件（用于导出）

数据位置可迁移:
  菜单「数据 → 更改数据存储位置…」→ 可选复制/仅切换 → 重启生效
```

---

## 12. Agent 对话协议（供接入参考）

**请求体** (`POST /api/agent/chat`)：
```typescript
{
  config: ApiConfig,          // 模型配置
  messages: ChatMessage[],    // 多轮历史
  projectId?: string,         // 关联作品
  confirmations?: ConfirmToken[], // 上轮确认/取消
  skillId?: string,           // 技能模式
  skillParams?: Record<string, any>
}
```

**NDJSON 事件流**（每行一个 JSON）：
```
{"type":"text","delta":"..."}           # 文本增量
{"type":"tool_call","name":"...","args":{}} # 工具调用
{"type":"tool_result","name":"...","result":"..."} # 工具结果
{"type":"proposal","proposal":{...}}    # 写操作提案（需确认）
{"type":"error","message":"..."}        # 错误
{"type":"done","sessionId":"..."}       # 结束
```

---

## 13. 数据流全景

```
创作流程:
  新建 → StepOutline 三步向导 → StepWriting 逐章生成
    ↓ 每章: buildChapterContext(检索+前情+伏笔) → generate → digest → recap
    ↓ 重写时: reconcile 统一下游
    ↓ Workspace 防抖 900ms → PUT /api/projects/[id]

Agent 流程:
  用户消息 → runtime.ts 工具循环 → 工具执行
    → 只读: 直接返回结果
    → 写操作: 产出 ChangeProposal → 等确认 → apply 落库
    → 生成类: 结果存 ctx.generated → save_project 折叠缓存为 patch

版本历史:
  save_project.apply() 前 → saveSnapshot(修改的章节) → 正常落库

导出:
  GET /api/export?projectId=X&format=epub → 服务端组装 → 二进制流

任务队列:
  enqueue(TaskDefinition) → runner.start() → 逐 step 执行
    → 每 step: runAgentTurn(skill mode, auto-approve)
    → 失败: 指数退避重试 → 超限: status=failed
    → 成功: checkpoint 持久化 → 全部完成: status=done
```

---

---

## 14. 关联文档

| 文档 | 用途 |
|------|------|
| [README.md](./README.md) | 面向终端用户的安装/使用指南 |
| [墨章对话Agent系统规范.md](./墨章对话Agent系统规范.md) | Agent 系统的原始设计规范（架构、接缝、工具定义、角色对话设计） |
| [TASKBOARD.md](./TASKBOARD.md) | 阶段一开发看板（并行协作记录、验收实测细节、缺陷修复方案） |
| [.github/workflows/release.yml](./.github/workflows/release.yml) | CI 自动构建与发布配置 |

> **建议新接手的 Agent**：先读本文件获取全局认知，再按需查阅上述关联文档获取细节。遇到架构疑问优先查 `TASKBOARD.md` 中的实测记录和修复方案。

---

*本文件反映 v1.0.0 状态（2026-07）。结构有较大调整时请同步更新。*
