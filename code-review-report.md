# 墨章 Novel Atelier — 代码审查与优化建议报告

> 审查对象：`E:\novel-workflow`（origin/main，阶段一~三已合）
> 审查方式：实际读码（Glob/Grep/Read 覆盖 `lib/`、`app/`、`components/`、`electron/`、配置与 `.github/`），非仅凭文档
> 审查维度：架构接缝 / 代码质量 / 性能 / 安全 / 可维护性测试 / 工程化

---

## 一句话总评

架构接缝（apiBase / Repository / ownerId / config-provider / auth / HITL 提案）设计清晰、Agent runtime 真正无状态且写操作幂等，整体工程素养高；但存在**一处会真正阻断任务队列的配置源缺陷**、**接缝在非项目数据（卡库/档案/会话）上未完全收敛**、以及**完全没有自动化测试与 CI 门禁**这三类硬伤，外加若干性能与代码组织层面的可落地改进。

---

## 已确认的优点（先讲正面，便于判断改进优先级）

- **NDJSON 解析有边界保护**：`lib/agent/mockStream.ts:158-181` 按行切分、逐行 `JSON.parse` 包 `try/catch`、尾部半行丢弃，无注入/崩溃面。
- **路径穿越防护到位**：`lib/storage.ts:52-56`、`lib/agent/session-store.ts:18`、`lib/roleplay/runtime.ts:29`、`lib/queue/store.ts:14` 均用 `safeId()` 过滤非 `[a-zA-Z0-9_-]` 字符。
- **Human-in-the-loop 写操作幂等**：`lib/agent/tools.ts` 的 `create_project`/`save_project` 通过 `propose()` 的 `argsPatch` 预分配 id/固化 patch，重复确认只覆盖同一目标（runtime.ts:282-296）。
- **Agent runtime 真无状态**：跨轮待确认写操作落盘 `data/proposals/*.json`，下一轮凭 `ConfirmToken.proposalId` 取回（`lib/agent/runtime.ts:182-225`、`session-store.ts:100-124`），不依赖进程内存。
- **接缝①~⑤结构完整**：`client.ts`(apiBase)、`repository.ts`(Repository+ownerId)、`config-provider.ts`、`auth.ts`、`reconcile.ts`(HITL) 均有注释标注"云就绪接缝"，契约冻结意识好。

---

## P0 — 发布前必修（正确性阻断）

### P0-1 任务队列启动时配置源错误，队列生成必失败
- **问题**：`components/TaskQueue.tsx:48` 在「开始」任务时从 `localStorage.getItem("p.config")` 读取配置并作为 `config` 发给 `POST /api/queue` 的 `start` 动作；但全仓库**没有任何地方写入 `p.config` 这个 key**（配置真源是 `lib/client.ts` 的 `PROFILES_KEY="novel-workflow.apiProfiles"`，经 `loadConfig()`/`getActiveProfile()` 读取）。因此该处永远取到 `{}`，服务端 `lib/queue/route.ts:39` 的 `getEffectiveConfig(body.config)` 透传为空，`validateConfig({})` 在 `lib/queue/runner.ts:58 → executeStep → runAgentTurn → chatCompletion` 链路里必然报"缺少 API 地址"，队列每一步生成都报错。
- **证据位置**：`components/TaskQueue.tsx:48`、`app/api/queue/route.ts:39`、`lib/queue/runner.ts:26-58`、`lib/client.ts:109-194`。
- **影响**：批量续写/摘要等队列任务无法真正产出内容（ 기능性阻断）。
- **建议方案**：把 `TaskQueue.tsx:48` 的 `JSON.parse(localStorage.getItem("p.config") || "{}")` 替换为 `import { loadConfig } from "@/lib/client"; const config = loadConfig();`（client.ts 已做 `typeof window` 守卫，客户端组件可直接用）。更稳妥的做法是在 `enqueue` 时把生效配置固化进 `TaskDefinition`/`TaskRun`，`start` 时优先用任务自带配置，避免每端重复取。
- **预估工作量**：0.5 天（含回归验证：入队→开始→观察步骤 `done`）。

> 备注：另需核实队列"入队"入口是否已接入 UI——`lib/queue/presets.ts` 提供了 `batchWriteChapters`/`batchDigest`/`fullPipeline`，但全局未找到调用 `enqueueTask` 或 `action:"enqueue"` 的前端代码（仅 `TaskQueue.tsx` 有 `start/pause/delete`）。若入队 UI 尚未接好，队列整体仍属半成品，此项优先级应升为 P0 并补全入口。

---

## P1 — 重要改进（架构/性能/工程化）

### P1-1 云就绪接缝不完整：非项目数据绕过 Repository，且客户端绕过 config-provider
- **问题**：
  1. `styles`/`archives` 的数据访问直接 `import` `lib/storage.ts`（`app/api/styles/route.ts`、`app/api/archives/route.ts`、`app/api/archives/[hash]/route.ts`、`lib/agent/tools.ts:40` 的 `listStyleCards/listArchives`），没有像 `ProjectRepository` 那样的接口与 `ownerId` 语义，未来换 DB 时这部分要单独改。
  2. 会话/提案（`session-store.ts`）与角色对话（`roleplay/runtime.ts`）各自直连 `dataRoot()`，未统一进接缝。
  3. 客户端 `TaskQueue.tsx:48` 绕过 `client.ts` 的 `loadConfig()` 直读 localStorage（见 P0-1）。
- **证据位置**：`lib/repository.ts:21-50`（仅 Project 有 Repository）、`app/api/styles/route.ts`、`app/api/archives/route.ts`、`lib/agent/tools.ts:40`、`components/TaskQueue.tsx:48`。
- **影响**：上云时接缝点散落，迁移成本高、易遗漏；与"换实现即可上云"的目标有落差。
- **建议方案**：为 `styles`/`archives` 补 `CardRepository`/`ArchiveRepository` 接口（镜像 `ProjectRepository` 的 `ownerId` 形参与单例导出）；把 `session-store`/`roleplay` 的持久化收敛到统一 `DataRepository` 或至少复用同一 `ownerId` 约定；客户端统一经 `client.ts` 取配置。
- **预估工作量**：1.5~2 天。

### P1-2 单文件 JSON 整本读写在大部头（百万字）下的 IO/内存与写入放大
- **问题**：`lib/storage.ts:85-90` 的 `saveProject` 每次 `JSON.stringify(project, null, 2)` 全量写回整个工程文件；`getProject` 全量读。百万字作品正文+设定库可达数十 MB，而 Agent 每确认一次写操作（`save_project.apply`，`lib/agent/tools.ts:326-354`）都会触发一次全量重写；`pretty` 缩进进一步放大体积。同一工程并发保存（如 UI 自动保存 + Agent 确认）还可能互相覆盖。
- **证据位置**：`lib/storage.ts:85-90`、`lib/agent/tools.ts:326-354`、`app/api/projects/[id]/route.ts`。
- **影响**：百万字下每次保存 30~50MB 序列化+落盘，卡顿明显；大上下文下内存占用高。
- **建议方案**（按性价比递进）：
  1. 短期：保存改用紧凑 `JSON.stringify(project)`（去缩进，体积降 ~30%+），并加"读-改-写"原子写（`writeFile` 到 `.tmp` 再 `rename`）。
  2. 中期：章节正文与设定库拆分子文件（如 `data/projects/<id>/volumes/<vid>/<cid>.json`），`ProjectRepository` 提供按卷/章的局部读写，避免整本重写。
  3. 并发：单工程保存加进程内互斥（同一 `id` 串行写）。
- **预估工作量**：原子写+去缩进 0.5 天；分文件存储 3~5 天（需改 `repository` 接口与所有读取方）。

### P1-3 完全没有自动化测试，且没有可用的 CI 门禁
- **问题**：
  1. 无任何测试框架：`node_modules/.bin` 中无 vitest/jest，`package.json` 无 `test` 脚本。验证仅靠 `tsc --noEmit`(经 `next build`)+ 手动回归。
  2. 无 ESLint 配置：仓库根无 `.eslintrc*` / `eslint.config.*`，`package.json` 也无 `eslint`/`eslint-config-next` 依赖，`npm run lint`（`next lint`）实际无配置可跑，等于没有静态检查门禁。
  3. `.github/workflows/release.yml` 仅在推送 `v*` 标签时构建 Windows 安装包，**没有 PR/推送 CI** 跑 `tsc`/`lint`/`test`，类型与风格错误可直入 `main`。
- **证据位置**：`package.json:9-18`（scripts/lint）、`.github/workflows/release.yml`、`lib/`（纯函数密集）。
- **影响**：重构风险高、`lib/` 大量纯函数（`retrieval`/`reconcile`/`types`/`prompts.extractJson`）本可低成本覆盖却裸奔；接缝改动易回归。
- **建议方案**：
  1. 引入 `vitest`，优先覆盖 `lib/retrieval.ts`、`lib/reconcile.ts`、`lib/types.ts`（`recordPromptEntry`/`applyDigest`/`applyReconcile`/`flattenChapters`）、`lib/prompts.ts` 的 `extractJson`，以及 Agent 确认流 `tools.ts` 的 `foldGenerated` 幂等。
  2. 补 `.eslintrc.json`（继承 `next/core-web-vitals`）并修复现有告警。
  3. 新增 `.github/workflows/ci.yml`：`npm ci → npx tsc --noEmit → npm run lint → npm test`（在 `ubuntu` 跑，不打包）。
- **预估工作量**：vitest+首批单测 2 天；CI+lint 0.5 天。

### P1-4 API Key 仅存 localStorage（XSS 暴露面，无 httpOnly）
- **问题**：`lib/client.ts:19-37` 把 `apiKey` 等配置存于 `localStorage`（key `novel-workflow.apiProfiles`），且每次请求经请求体把 key 传服务端（`config-provider.ts:16-21` 当前为透传）。本应用为本地桌面、无远程内容，XSS 面较小（且全仓库无 `dangerouslySetInnerHTML`，React 自动转义），但一旦上云或未来引入任何富文本/外部内容渲染，key 可被脚本读取外泄。
- **证据位置**：`lib/client.ts:19-37,181-194`、`lib/config-provider.ts:16-21`、`lib/future-stubs.ts:48-61`（`createSecretStore` 已预留但未实现）。
- **影响**：当前可接受；云化路线的安全前置债。
- **建议方案**：上云前落地 `SecretStore`（`future-stubs.ts` 已有接口），密钥改存服务端按 `ownerId` 取，`config-provider.getEffectiveConfig` 改为忽略/合并客户端 config 而用服务端密钥；本地模式可保留 localStorage 但加 `httpOnly` 同类考量（Electron 下可用 `safeStorage` 加密落盘）。
- **预估工作量**：服务端密钥库 2~3 天（云化阶段）。

### P1-5 任务队列"入队"入口疑似未接入 UI
- **问题**：见 P0-1 备注。`lib/queue/presets.ts` 已定义模板，但前端未见触发 `enqueue` 的调用；`TaskQueue.tsx` 仅做列表/开始/暂停/删除。若确实未接，则队列功能对终端用户不可用。
- **证据位置**：`lib/queue/presets.ts`、`components/TaskQueue.tsx`、`app/api/queue/route.ts:25-32`。
- **影响**：阶段三声称的"任务队列（断点续跑）"可能未对用户提供完整闭环。
- **建议方案**：在写作/批量面板接入 `batchWriteChapters`/`batchDigest` 的入队按钮，入队时把 `loadConfig()` 的结果固化进任务，并补端到端手动回归用例。
- **预估工作量**：1 天（接入+联调）。

---

## P2 — 可选优化（代码组织/健壮性）

### P2-1 超大文件拆分
- **证据**：`components/StepOutline.tsx` 1683 行（~54KB）、`lib/prompts.ts` 856 行（~41KB）、`lib/agent/tools.ts` 973 行、`components/StepWriting.tsx` 1085 行、`components/RoleplayChat.tsx` 608 行。
- **影响**：单文件承担过多职责，改动易冲突、PR 难 review、测试难聚焦。
- **建议方案**：
  - `StepOutline.tsx` 拆出 `VolumeCard` / `ChapterRow` / `OutlineToolbar` / `OutlineDiff` 等子组件。
  - `prompts.ts` 按领域拆为 `prompts/bible.ts`、`prompts/volume.ts`、`prompts/chapter.ts`、`prompts/digest.ts`、`prompts/roleplay.ts`、`prompts/style.ts`、`prompts/archive.ts`，统一导出 `extractJson`。
  - `tools.ts` 按 A/B/C/D 四组拆为 `agent/tools-data.ts` / `agent/tools-generate.ts` / `agent/tools-memory.ts` / `agent/tools-analysis.ts`，主文件只做注册。
- **预估工作量**：2~3 天（纯重构，需配单测防回归）。

### P2-2 魔法值集中
- **证据**：`maxTokens: 8192` 在 `lib/agent/tools.ts`、`lib/llm.ts`、`app/api/generate/*.ts` 共出现 9 处；`MAX_STEPS=8`/`MAX_STEPS_SKILL=12`（`runtime.ts:150-151`）、`MAX_CHAPTERS=60`（`reconcile.ts:75`）、`temperature` 默认值散落（`llm.ts:48`、`client.ts:50`）。
- **建议方案**：新增 `lib/constants.ts` 导出 `LLM_MAX_TOKENS`、`AGENT_MAX_STEPS`、`RECONCILE_CAP` 等，全仓引用。
- **预估工作量**：0.5 天。

### P2-3 Electron 随机端口的 TOCTOU 竞态
- **问题**：`electron/main.js:32-41` 的 `getFreePort()` 先 `listen(0)` 取端口再 `close()`，随后 `fork` 服务用该端口；关闭到绑定之间存在时间窗，理论上可被其他进程抢占导致 `EADDRINUSE`，`waitForServer` 超时后显示"启动失败"。单实例锁（`requestSingleInstanceLock`）降低了概率，但未根除。
- **证据位置**：`electron/main.js:200-226`（尤其 `getFreePort` 与 `fork` 之间）。
- **建议方案**：`fork` 时传 `PORT=0` 让系统分配，启动后从子进程 stdout/IPC 读取实际端口；或由 `main.js` 自己 `listen` 占用该端口再 `fork`（把 socket fd 传给子进程，需 `child_process` 高级用法）。低优先级。
- **预估工作量**：0.5~1 天。

### P2-4 Agent 会话历史整段落库 + 跨轮重发，长对话膨胀；"generate 必须同轮 save"的设计脆弱
- **问题**：
  1. `app/api/agent/chat/route.ts:95-127` 每次把**完整 messages（含工具活动）**整段写回 `chat-<projectId>.json`，且客户端每轮把全量历史重发给服务端（`useChat.ts:76-82`）。长对话下文件与请求体都持续膨胀。
  2. `save_project` 的 `foldGenerated` 读取 `ctx.generated`（每次 `runAgentTurn` 新建的 `{}`，`runtime.ts:177`），因此 **generate 与 save 必须在同一轮**；若模型在上一轮 generate、下一轮才 save，缓存已空会落空（`tools.ts:305-324` 的 `kinds=Object.keys(cache)` 取不到）。依赖模型"同轮连发"行为，脆弱。
- **证据位置**：`app/api/agent/chat/route.ts:95-127`、`lib/agent/runtime.ts:173-178`、`lib/agent/tools.ts:305-324`、`lib/agent/useChat.ts:76-82`。
- **建议方案**：会话历史做滚动裁剪/摘要（保留最近 N 轮 + 系统上下文）；把"已生成候选"在产生时即随提案固化进 `proposal.args`（类同 `save_project` 现有 `argsPatch`），使跨轮 save 不再依赖内存缓存。
- **预估工作量**：1~2 天。

### P2-5 未使用导出/重复与一致性
- **证据**：
  - `lib/client.ts:259-286` 的 `streamPost` 在 Agent 流程中未被采用（Agent 走 `mockStream.httpChatStream`/`useChat`），属冗余或待清理。
  - `types.ts:285-315` `recordPromptEntry` 与 `enabledPrompts` 良好，但 `storage.ts:25-46 normalizeProject` 与 `types.ts` 的默认值存在双重"补字段"逻辑，旧数据迁移逻辑分散。
- **建议方案**：删除/归档未用导出；把旧数据 normalize 收敛到单一 `migrateProject()`。
- **预估工作量**：0.5 天。

### P2-6 安全响应头缺失（上云前置）
- **问题**：`next.config.mjs` 仅设 `output/standalone` 与 `images.unoptimized`，无 `headers`（CSP/HSTS/X-Content-Type-Options）。本地应用影响小，但上云前需补。
- **证据位置**：`next.config.mjs`。
- **建议方案**：上云时在 `next.config` 的 `async headers()` 增加基础 CSP（至少 `default-src 'self'`、限制连接域名）、`X-Content-Type-Options: nosniff` 等。
- **预估工作量**：0.5 天（云化阶段）。

---

## 最高性价比 Top 3 立即可做清单

| # | 事项 | 对应项 | 工作量 | 收益 |
|---|------|--------|--------|------|
| 1 | **修 TaskQueue 配置源**：`TaskQueue.tsx:48` 改用 `loadConfig()`，并核实/补全队列入队 UI | P0-1 / P1-5 | 0.5~1.5 天 | 解除队列功能阻断，让"断点续跑批量任务"真正可用 |
| 2 | **引入 vitest + 首批纯函数单测 + PR CI + ESLint 配置**：覆盖 `retrieval/reconcile/types/prompts` 与 Agent 确认流幂等 | P1-3 | 2.5 天 | 立即把重构风险压下来，给后续接缝收敛（P1-1）与拆分（P2-1）提供安全网 |
| 3 | **拆分 `prompts.ts` 与 `StepOutline.tsx` 为子模块 + 集中魔法值到 `lib/constants.ts`** | P2-1 / P2-2 | 2.5 天 | 降低每次改动的冲突面与 review 成本，为后续大改（分文件存储 P1-2）铺路 |

> 建议执行顺序：**先 2（建安全网）→ 再 1（修阻断）→ 然后 3（减负）→ 并行推进 P1-1/P1-2/P1-4 的云化准备**。P1-4/P2-6 明确属于"上云阶段"工作，当前本地优先定位下可排期但不紧急。

---

## 结论

代码质量与架构意识在同类项目中属上乘，接缝设计与 HITL 机制尤其值得肯定。当务之急是用**最小代价**消除"队列配置源"这一确定性阻断缺陷，并补齐**测试与 CI 门禁**这一最大可维护性短板——这两项做完，后续所有的架构收敛（Repository 补全、分文件存储、云化密钥库）都能在受保护的情况下稳步推进。
