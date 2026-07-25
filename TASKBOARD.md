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

> **序列化格式（Sub A 已定，Sub B 已对齐）**：`/api/agent/chat` 返回 `Content-Type: application/x-ndjson`，
> 逐行一个 `AgentStreamEvent` 的 `JSON.stringify`，以 `\n` 分隔，末尾必有 `{"type":"done"}`。
> 客户端 `httpChatStream(apiBase)` 按行解析（半行缓冲拼齐），按 `type` 分发。

---

## 3. Sub A · 后端 / Agent（`feat/agent-backend`）✅ 已合入 main

参照规范 §2 / §3 / §5。归属文件：`lib/repository.ts`（实现加固）、`lib/config-provider.ts`、`lib/auth.ts`、`lib/storage.ts`（收敛）、`lib/agent/tools.ts`、`lib/agent/runtime.ts`、`app/api/agent/chat/route.ts`。

- [x] 接缝①：`lib/client.ts` 新增 `getApiBase/setApiBase/apiUrl`，REST 统一走 `apiUrl()`
- [x] 接缝②：`app/api/projects*` 与工具层经 `projectRepository` 访问；`ownerId="local"` 落盘与今天一致
- [x] 接缝④：`lib/config-provider.ts` 集中获取生效 `ApiConfig`
- [x] 接缝⑤：`lib/auth.ts` no-op 鉴权，注入 `ownerId="local"`
- [x] `lib/agent/tools.ts`：注册 A/B/C 组工具（规范 §3.4），映射真实符号
- [x] `lib/agent/runtime.ts`：Agent 工具循环 + 写操作确认流编排（产出 `ChangeProposal`，凭 `ConfirmToken` 落库）
- [x] `app/api/agent/chat/route.ts`：NDJSON 流式回传 `AgentStreamEvent`
- [x] `ChatSession` 经 `sessionRepository` 落存储（按作品收敛 `chat-<projectId|global>`）

**进度 / 备注：**
- 序列化格式见 §2（NDJSON）。会话按作品落一段可续写对话；本轮助手文本 + toolCalls 累积入库。

---

## 4. Sub B · 客户端 / UX（`feat/agent-ui`）✅ 已合入 main

参照规范 §3.5 / §5。归属文件：`components/AgentChat.tsx`、`lib/agent/useChat.ts`、`lib/agent/mockStream.ts`、`app/agent/page.tsx`、变更提案确认 UI。

- [x] `components/AgentChat.tsx`：对话面板（消息列表 + 输入框 + 流式渲染）
- [x] 解析 `AgentStreamEvent`：文本增量、工具调用/结果展示（`useChat` 状态机）
- [x] 变更提案确认流：收到 `proposal` 渲染 changeSummary + diff，「确认/取消」→ 下一轮回传 `confirmations`
- [x] 独立入口 `app/agent/page.tsx` 已就绪；**已接入三栏右栏 AgentPanel**（`c286eb0`，AgentChat 双模嵌入）
- [x] 默认 transport 已切真实 `/api/agent/chat`（`httpChatStream(getApiBase())`），可覆盖为 mock

**进度 / 备注：**
- mock 与真实传输同置 `mockStream.ts`；集成时 `AgentChat` 默认真实端点，演示可传 `transport={mockChatStream}`。

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

- [x] `apiBase` 可配置，默认本地端口，切换 URL 后请求正确改向 —— 接缝①已落地（见 §3）。
- [x] 数据读写经 `ProjectRepository`，`ownerId="local"` 落盘与改造前一致（旧作品可正常打开）—— 接缝②已落地。
- [x] 对话面板可用自然语言完成：新建作品 → 生成设定集 → 生成分卷脉络 → 续写某章草稿 —— **已于 2026-07-25 用真实模型（deepseek-v4-flash）逐条端到端跑通**（详见 §9 T1）；期间发现并修复了「生成候选→save_project 落库」的模型中继 JSON 缺口（方案 b：`generated` 缓存 + `fromGenerated` 服务端折回）。
- [x] 每个写操作弹出变更提案并等待确认，取消则不落库 —— 实测：写操作只出 `proposal` 不落库，确认后 `apply` 才写盘；并已幂等硬化（`947a9c6`，确认一次 = 落库一次）。
- [~] 桌面版仍为单 exe，数据位置沿用现有自定义逻辑 —— 本阶段未改动 Electron 打包与数据定位逻辑，**未做桌面回归**，视为保持不变。

---

## 8. 阶段一收尾状态

- 阶段一已合入 `main` 并推送 `origin/main`（至 `947a9c6`）。
- 提交栈：`8495eb1`（契约冻结）→ `6d34a21`（Sub A）→ `9e458c8`（Sub B）→ `f9a0757`（真实 NDJSON）→ `f5d41ad`（看板）→ `ae5b20a`（checkpoint）→ `c286eb0`（三栏接入）→ `ffb2caa`（模型名）→ `947a9c6`（幂等硬化）。
- 当前工作区有两处**未提交**的文档改动（本看板 §7/§8、规范 §8），随收尾一并提交。

---

## 9. 下一阶段 · 阶段一收尾（当前主攻）

> 目标：闭合阶段一验收 §7 中仍为 `[~]` 的两项（UI 端到端逐条回归、桌面单 exe 回归），并把工具覆盖对齐规范 §3.4。收尾达标后方可移交阶段二（酒馆式角色卡对话）。

### 现状订正（务必以此为准）
- **工具覆盖**：`tools.ts` 已注册 **17 个**——A(5) + B(8) + C(4，含 `apply_digest`/`apply_reconcile`）。此前看板/口径误记 C 组 apply_* 缺失，已订正：**C 组齐全**。
- 所有 `generate_*` 均为 `write=false` 候选生成器；**落库统一经 `save_project` 走提案→确认→落库**。
- 规范 §3.4 的 **D 组拆书学工具（`analyze_style`/`analyze_archive`/`list_style_cards`/`list_archives`）尚未注册**；按规范 §4 属阶段二「二创开新书」前置，非阶段一验收项 → 列为**可选提前项 T4**。

### T1 · UI 端到端逐条回归（对话面板 + 真实模型）｜✅ 已通过 §7.3
> 实测于 2026-07-25，`localhost:3000` + 真实模型 `deepseek-v4-flash`。窄视口下三栏布局塌陷（右栏 AgentPanel 宽度为 0，无法直接点按），故改用**页面内 fetch 复刻 `useChat` 协议**（`window.__t1` harness：`cfg()` 读 localStorage `p.config`；`turn(confirmations)` POST `/api/agent/chat` 解析 NDJSON）验证流式 API 契约——符合本项目既有实践。

**通过项 ✅**
- [x] NDJSON 事件流完整：只读链 `list_projects` 得 `tool_call/tool_result/text/done`；写链得 `tool_call/proposal/done`，`error` 分支亦正常。
- [x] 旧作品可打开：`list_projects` 正常返回既有 8 部作品（标题齐全）。
- [x] 写操作确认流（以 `create_project` 全链验证）：先出 `proposal` **不落库**；**取消（approved=false）不落库**（仍 8 部）；确认后落库（8→9，新建测试作品 `mrz82nso4vid`）；**幂等**——对已应用提案重复确认返回「提案已失效或不存在」，count 不变。

**阻塞缺陷 ⛔ → 已修复 ✅（2026-07-25）**
- 初测（对 `mrz82nso4vid`）：**`generate_* → save_project` 两步链无法落库**——模型正确编排 `get_project → generate_bible → save_project`，但 `save_project` 的 `proposal.args` 恒为 `{}`（`changedKeys:[]`），确认后 `bible` 仍为 `null`；**显式指令重试仍为空 patch**，排除提示词因素。
  - **根因**：`save_project.patch` 原为**无内层 schema 的裸 `object`**，function-calling 模型（deepseek-v4-flash）不填充大型嵌套自由对象参数。
- **采用方案 (b) 修复**（`lib/agent/tools.ts` + `lib/agent/runtime.ts`）：
  - `ToolContext` 增本轮共享 `generated` 缓存；各 `generate_*` 的 `run()` 产出后 `remember(ctx, kind, payload)`（kind∈bible/volumes/volume/chapter/chapter_outline/recap）。
  - `save_project` 增 `fromGenerated: string[]` 参数；`propose` 经 `foldGenerated()` 从缓存**服务端合并**出补丁（含分卷/章节等嵌套写回），并固化进 `argsPatch.patch`，`apply` 直接覆盖落库——模型全程无需复制 JSON。
  - **关键兜底**：`fromGenerated` 省略且无手动 `patch` 时，默认折回本轮全部已生成候选 → 即使模型以空 `save_project()` 调用也能正确落库。
  - 系统提示同步：指引模型用 `fromGenerated:['bible']` 保存、切勿复制 JSON。`npx tsc --noEmit` 通过。
- **修复后全链复测（新测试作品 `mrz8wk5p1rhq2`，setup=玄幻/听草玉，事后已删）**：
  - [x] 设定集：`generate_bible → save_project`，`changedKeys:[bible,title]`，确认后 `bible` 落库（logline/8 人物）、`title→草木知音`。
  - [x] 分卷脉络：`generate_volumes → save_project`，`changedKeys:[volumes]`，确认后 3 卷落库。
  - [x] 单卷展开：`generate_volume → save_project`，嵌套并入 vol1 的 3 章（`empty`）。
  - [x] 续写草稿：`build_chapter_context → generate_chapter → save_project`，`changedKeys:[volumes]`，确认后首章 `content` 写回 4334 字、`status: empty→draft`。
- 结论：**平台契约、确认流与三条生成链均已实测通过**（NDJSON 完整、取消不落库、确认落库幂等由 create_project + 各链 propose→confirm 复核）；「生成候选→落库」的模型中继 JSON 缺口已由方案 (b) 消除。**T1 达标，§7.3 可关闭。**

**三链幂等 + 取消专项复测 ✅（2026-07-25，测试作品 `mrz9m057xmmjg`，setup=玄幻/听草玉，事后已删）**
> 逐链验证：`propose → 取消(approved=false)不落库 → 重新生成 → 确认(approved=true)落库 → 重复确认同一 proposalId`。

| 链 | 取消不落库 | 确认落库 | 重复确认（幂等） |
|----|:---:|:---:|:---:|
| `generate_bible→save_project` | ✅ `bible` 仍 `null` | ✅ logline+9 人物、`title→木语仙踪` | ✅ `提案已失效或不存在：<id>`，数据未变 |
| `generate_volumes→save_project` | ✅ `volumes` 仍 0 | ✅ 3 卷落库 | ✅ 同上，仍 3 卷 |
| `generate_chapter→save_project` | ✅ `content` 仍空、`empty` | ✅ 正文 3365 字、`status: empty→draft` | ✅ 同上，正文未变 |

- **取消**：事件流 `tool_result(discarded:"用户已取消该写操作")/text/done`，DB 完全未变。
- **确认**：`apply` 落库后 `deletePendingProposal` 删除提案文件。
- **重复确认**：`getPendingProposal` 返回 `null` → 发 `error` 事件 `提案已失效或不存在：<id>`，数据不被二次应用——方案 (b) 新增的非空嵌套 patch（bible/volumes/chapter）同样满足「确认一次 = 落库一次」。
- 过程注记：模型偶发「只用文本叙述而未真正触发工具」（`tools:[]`、无 `proposal`），补发强制指令后即正常发起工具调用——属模型行为，非平台缺陷。
- 清理：测试作品已删（`data/projects` 恢复 8 部）、残留提案清空（`data/proposals` 为 0）。

### T2 · 桌面单 exe 回归｜阻塞验收 §7.5
- [ ] `npm run app:build:win`（或 `app:build`）构建 NSIS 安装包成功。
- [ ] 安装/启动后：数据存储位置沿用现有自定义逻辑（`NOVEL_DATA_ROOT` / 菜单改路径）不变。
- [ ] Electron 窗口内右栏 AgentPanel 可用，至少跑通一次 `create_project` 提案→确认闭环。

### T3 · 收尾文档同步 + 提交
- [ ] T1/T2 通过后，把 §7 对应项由 `[~]` 改 `[x]` 并附实测结论。
- [ ] 提交未提交的两处文档改动 + 本轮看板更新；推送 `origin/main`。

### T4 · （可选，阶段二前置）补齐 D 组拆书学工具
- [ ] 扩展 `AgentTool.group` 类型加 `"D"`。
- [ ] 新增 `analyze_style`/`analyze_archive`（复用 `/api/style-analyze`、`/api/archive-analyze` 的 prompt 构造 + `completeChat`，服务端进程内直调，参照 B 组只读候选模式）。
- [ ] 新增 `list_style_cards`/`list_archives`（只读，列 `data/styles`、`data/archives` 缓存目录）。
- [ ] 注册进 `AGENT_TOOLS` 并 `npm run build` 通过。

### 收尾完成判据（Definition of Done）
- §7 全部为 `[x]`（含实测结论）；`npm run build` 与桌面打包均通过；`main` 已推送且工作区干净。
