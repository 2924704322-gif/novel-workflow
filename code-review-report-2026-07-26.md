# 项目全面复审报告（2026-07-26）

> **性质**：只读审查 + 实机核验，本次审查**未修改任何源码**。
> **范围**：全部项目自有 Markdown 文档（12 份）+ 新主界面重构（FT-01~FT-14）与酒馆AI MVP（FT-15~FT-23）全部落地代码。
> **前置文档**：上一次审查见 `code-review-report.md`；实施记录见 `.workbuddy/memory/2026-07-25.md`；合并终稿见 `deliverables/software-company/novel-ui-landing-final.md`。
> **给后续工作者**：先读本文「三、问题清单」与「五、建议收口顺序」，P0 必须最先修。

---

## 一、实机核验结果（本次审查实测，非文档转述）

| 核验项 | 此前文档记载 | 本次实测结果 |
|---|---|---|
| `tsc --noEmit` | 0 错误 | ✅ 确认 EXIT=0，0 错误 |
| vitest 测试 | 「沙箱 vitest 二进制损坏，无法运行」 | ⚠️ **实际可跑**：`node node_modules/vitest/vitest.mjs run`（绕过缺失的 `.bin/vitest.cmd`）→ **13 个测试文件，90 测试中 89 通过、1 失败**（失败原因见 P2-1，是测试用例自身 bug，非实现缺陷） |
| `next build` | 「被沙箱 .next 守卫拦截，待本地确认」 | ❌ **构建失败（P0）**，webpack `Module not found: Can't resolve 'fs'`，详见 P0-1 |
| git 状态 | 「各项改动未提交（主理人统一收口）」 | ✅ 确认：**40 个文件修改 + 40 余个新文件/目录全部未提交**，HEAD 停在 `fd1c97a`（重构开始前） |

---

## 二、本轮未提交改动全景（后续工作者需知道"改了什么"）

> git HEAD = `fd1c97a docs: 项目技术文档全面重写`。以下全部为工作区未提交内容，
> 对应 FT-01~FT-23 两大工程（新主界面 v5.2 重构 + 酒馆AI SillyTavern 范式 MVP）。

### 2.1 新建 — 新主界面（Studio）

| 文件 | 职责 |
|---|---|
| `components/studio/StudioProvider.tsx` | 工作室共享状态 Context（selectedBookId / rightMode / rightSeg / chat / confirmMd 落稿闭环 / roleplay 状态） |
| `components/studio/StudioShell.tsx` | 新三栏外壳（topbar 52px + 左 248/56 + 中 flex:1 + 右 380/0）；`?book=` 深链打开 |
| `components/studio/LeftNav.tsx` | 左栏纯导航（酒馆AI 入口 + 书架） |
| `components/studio/ChatStudio.tsx` | 中栏 AI 对话（create-bar 四 chip + 消息流 + composer + plus 展开器 + 对话内模态） |
| `components/studio/CreateBar.tsx` / `Composer.tsx` / `PlusPanel.tsx` / `InDialogModal.tsx` | 中栏子组件 |
| `components/studio/HitlMdCard.tsx` | 可编辑 .md HITL 提案卡（Q12 targetChapterId 透传） |
| `components/studio/RightDock.tsx` | 右栏容器，`#page-book` / `#page-tavern` CSS 互斥双详情页 |
| `components/studio/BookDetail.tsx` | 书详情三分段 [成果\|阅读\|文档]；挂任务队列/导出/版本历史入口 |
| `components/studio/TavernDetail.tsx` | 酒馆AI 详情页 + 「打开配置台」入口 |
| `components/studio/Reader.tsx` / `DocList.tsx` / `DocReader.tsx` | 方格稿纸阅读器 / .md 列表 / Markdown 渲染（当前用自研 `lib/markdown.ts` 兜底） |
| `components/studio/Skeleton.tsx` / `ErrorNote.tsx` / `EmptyState.tsx` | 状态组件（FT-12） |
| `components/studio/icons.tsx` | 自绘 lucide 同款线性 SVG（命名与 lucide-react 一致，可无缝替换） |
| `components/studio/tavern/`（5 文件） | 酒馆配置台：TavernConfigEntry 模态壳 + Character/Lorebook/Group/Preset 四管理器（FT-22） |

### 2.2 新建 — 存储 / 数据层

| 文件 | 职责 |
|---|---|
| `lib/docsStore.ts`（+test） | 设定类 .md 事实源，`data/projects/<id>/docs/`，front-matter kind 必填，路径穿越三重防护 |
| `lib/migrate.ts`（+test） | `migrateBibleToDocs`（首开旧书一次性拆 bible→.md，幂等，旧 JSON 不删）+ `syncDocsToBible`（.md 确认后回填 bible 切片） |
| `lib/studioActions.ts`（+test） | `applyMdDraftToStorage` 落稿闭环（章节→applyChapterContent；设定→docsStore.save+syncDocsToBible）+ `resolveChapter` 三级定位 |
| `lib/markdown.ts` | 零依赖 md→html（已做 HTML 转义 + URL 白名单，安全），react-markdown 的离线兜底 |
| `lib/tavern/store.ts` | tavernStore：`data/tavern/{characters,lorebooks,groups,presets}/`，safeSegment+safeFile 防穿越，list 按 ownerId 过滤 |
| `lib/tavern/types.ts` | Character Card V2 / Lorebook / RoleplayGroup / TavernPreset 类型 |
| `lib/tavern/sync.ts`（+test） | FT-23 单向同步：world 类 .md→项目世界书 entry（sourceDoc 幂等、只覆盖 content）；character 类→角色卡 data.description。**绝不回写 .md（Q5）、绝不回写 codex（Q4）** |
| `lib/roleplay/characterCard.ts` | codex→V2 映射 / loadCharacter（优先已存卡，回退 codex 生成）/ saveCharacter |
| `lib/roleplay/lorebook.ts`（+test） | 世界书扫描注入引擎：字面+正则 key、constant 恒注、递归 2 层防环、scanDepth 窗口、token 预算裁剪（constant 永不被裁，priority 高者先留） |
| `lib/roleplay/persona.test.ts` | assembleRoleContext 单测 |
| `lib/constants.ts` | 共享常量 |

### 2.3 新建 — API 路由

| 路由 | 说明 |
|---|---|
| `app/api/tavern/characters/route.ts` | GET 列表（ownerId 隔离）/ POST 保存（校验 spec+codexId，强注 ownerId）/ DELETE |
| `app/api/tavern/characters/[codexId]/route.ts` | GET 单卡全文（⚠️ 无鉴权，见 P1-3） |
| `app/api/tavern/lorebooks/route.ts` / `groups/route.ts` | GET/POST/DELETE，POST 校验 novelchat.ownerId 一致 |
| `app/api/tavern/presets/route.ts` | ⚠️ **stub**：GET 恒空、POST 不落库（见 P1-2） |
| `app/api/tavern/sync/route.ts` | POST {projectId} → getProject → syncDocsToTavern |

### 2.4 新建 — 拆分与测试基建

- `lib/agent/tools-{data,generate,memory,analysis,shared}.ts`：原 tools.ts 按组拆分，`tools.ts`（113 行）只做注册与再导出，公共 API 不变。
- `lib/prompts/{shared,bible,volume,chapter,digest,reconcile,style,archive}.ts`：原 prompts.ts 拆分，`prompts.ts`（23 行）为 barrel。
- `components/step-outline/`（9 文件）：StepOutline 拆出的子组件。
- 测试：`lib/*.test.ts`、`lib/__tests__/`、`vitest.config.ts`、`.github/workflows/ci.yml`、`eslint.config.mjs`。
- 其他：`public/logo.svg`、`electron/fonts/`（等待 NotoSerifSC.woff2）、`.verify/`（CJS 逻辑 harness）。

### 2.5 修改（40 文件，要点）

- `app/page.tsx`：书房 hub → 挂载 StudioProvider + StudioShell（新主界面根屏）。
- `app/project/[id]/page.tsx`：→ 深链重定向 `/?book=<id>`（Q7）。
- `app/layout.tsx` / `components/TopBar.tsx`：品牌 → Novel&Chat。
- `app/globals.css`：清爽风令牌主层（`--accent #d97757` 等）+ 暖阁降级层双层共存；`[data-theme="dark"]` 预留。
- `components/TaskQueue.tsx` / `HistoryPanel.tsx` / `ExportDialog.tsx`：重画清爽风、去 Tailwind 暗色类；TaskQueue **P0-1 已修**（改用 `loadConfig()`，不再读不存在的 `localStorage["p.config"]`）；三件套挂载进 BookDetail。
- `components/RoleplayChat.tsx` + `lib/roleplay/{persona,runtime,useRoleplay,types}.ts` + `app/api/agent/roleplay/route.ts`：FT-19/21，接入角色卡 V2 + lorebook + 群组（assembleRoleContext），RoleplayChat 迁入中栏。
- `lib/agent/{runtime,types,useChat,mockStream}.ts`：ChangeProposal 扩展 `md?: MdDraft`；`confirm(id, ok, mdBody?)` 第三参回填编辑后正文（幂等）。
- `lib/repository.ts`：新增 `applyChapterContent` 接缝。
- `electron/main.js`：注册 `app://` 字体协议（Q2 离线字体）。
- `components/{AppShell,LeftRail,AgentPanel,Workspace}.tsx`：标 DEPRECATED（未删）。
- 删除：`start-dev.bat`。

---

## 三、问题清单（本次审查发现，按严重度）

### P0（阻断发布，必须最先修）

**P0-1 `next build` 构建失败：client 组件直连 Node `fs`**

```
Module not found: Can't resolve 'fs'
  ./lib/docsStore.ts    ← ./lib/studioActions.ts ← ./components/studio/StudioProvider.tsx ← ./app/page.tsx
  ./lib/storage.ts      ← ./lib/repository.ts    ← ./lib/studioActions.ts ← …
```

- 根因：`StudioProvider.tsx`（`"use client"`）经 `lib/studioActions.ts` 直接 import 基于 `fs` 的 `docsStore` / `repository`；`BookDetail.tsx` 也直接 import `docsStore` / `migrate` / `projectRepository`。
- 此前各批次只用 `tsc --noEmit` 验证（tsc 不检查 client/server 运行时边界），故一直未暴露。
- **修法**：落稿/读盘改走 API 路由（如新增 `/api/projects/[id]/docs`、`/api/studio/confirm-md`，或复用现有 `/api/projects/[id]`），客户端只 fetch——即回到项目自己定义的「云就绪五接缝」（`lib/client.ts` apiBase）应有形态。涉及改造点：
  1. `StudioProvider.confirmMd` → fetch API（服务端调 `applyMdDraftToStorage`）；
  2. `BookDetail` 的 project/docs/迁移三个 useEffect → fetch API（服务端调 `docsStore.list/read` + `migrateBibleToDocs`）；
  3. `lib/studioActions.ts` 保持纯服务端模块，不再被任何 `"use client"` 文件 import。

### P1（发布前应修）

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| P1-1 | 中栏创作对话未接真实后端 | `components/studio/ChatStudio.tsx` L38-L43 | transport 硬编码 `mockChatStream`（注释自述"联调/生产请替换"）。新主界面核心能力当前只是演示流。修法：换 `httpChatStream(getApiBase())`，对齐 `AgentChat.tsx` 的做法 |
| P1-2 | presets 保存静默丢数据 | `app/api/tavern/presets/route.ts` | GET 恒返回 `[]`、POST 接受任意 body 仅回 ok 不落库；但 `TavernPresetManager` UI 已上线、`lib/tavern/store.ts` 的 `savePreset/listPresets/readPreset/removePreset` 已实现。**只差路由接线** |
| P1-3 | 单卡路由无鉴权 + DELETE 不校验归属 | `app/api/tavern/characters/[codexId]/route.ts`（GET 无 resolveAuth 无 ownerId 校验）；characters/lorebooks/groups 三处 DELETE 只鉴权不校验资源归属 | 本地单用户可容忍；**云化前必修** |
| P1-4 | 全部改动未提交 git | 工作区 | 约 58.5 人天当量的两大工程无版本保护。建议按功能模块分批提交（参照既有提交规范：`feat:`/`docs:` 前缀 + TASKBOARD 章节关联） |

### P2（择机修）

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| P2-1 | vitest 1 个失败是**测试用例自身 bug** | `lib/roleplay/lorebook.test.ts` L138-L145 | 「scanDepth 限制扫描窗口」用例把含关键词的消息 `push` 到数组**末尾**，而实现 `slice(-scanDepth)` 取「最近 N 条」（对齐 SillyTavern 语义）→ 末 20 条必然含最后一条，命中是正确行为。**修测试**：把关键词消息放到开头（如 `many.unshift(...)` 后再补足长度） |
| P2-2 | 写入非原子 | `lib/docsStore.ts` saveDoc、`lib/tavern/store.ts` writeJson | 直接 `writeFile`，无 tmp+rename；断电/崩溃可能留半截文件 |
| P2-3 | resolveChapter 零分兜底可能覆盖错章 | `lib/studioActions.ts` L50-L72 | 模糊匹配 bestScore 初始 -1，文件名完全不匹配时静默落首卷首章。建议：零分时拒绝落稿并向用户报错，而非兜底 |
| P2-4 | StepOutline / StepWriting 未标 DEPRECATED | `components/StepOutline.tsx`(1039 行)、`StepWriting.tsx`(1085 行) | 仅被已废弃的 Workspace 引用，无活跃路由触达；应补 DEPRECATED 头注释（其余四个旧组件已标） |
| P2-5 | lorebook selective 注释与实现不一致 | `lib/roleplay/lorebook.ts` L121-L129 | 注释称"需全部 keys 命中"，实现只要求任一 primary key 命中 + 全部 secondary 命中。按 SillyTavern 语义实现是对的，**改注释** |
| P2-6 | assembleRoleContext 排除自身靠引用相等 | `lib/roleplay/persona.ts` L193 | `m !== card` 依赖 runtime 传同一实例；若上游各自加载卡片会重复注入发言者。建议改比 codexId |
| P2-7 | ChatStudio chatFacade 是静态假快照 | `components/studio/ChatStudio.tsx` L46-L68 | 注册进 Provider 的 facade 的 messages/streaming 等字段恒为空/false（仅方法经 ref 转发）；且注册 effect 依赖整个 studio 值，造成多余渲染往返 |
| P2-8 | confirmMd 失败无用户可见反馈 | `components/studio/StudioProvider.tsx` L148-L150 | 仅 console.error，用户以为写入成功 |
| P2-9 | lucide-react 死依赖 | `package.json` L26 | 已装 `lucide-react@^0.460.0` 但全站用自绘 `icons.tsx`（当时离线装不上）。二选一：换回 lucide import，或移除依赖 |
| P2-10 | globals.css 注释解析警告 | `app/globals.css` | 注释内写了 `--fg*/--accent` 等，`*/` 提前终止注释块，next build 报 `Unexpected token Delim('*')` 警告（非阻断） |
| P2-11 | react-markdown / remark-gfm 仍未安装 | `package.json`、`components/studio/DocReader.tsx` | Q8 拍板选型未落地，当前用自研 `lib/markdown.ts` 兜底（已转义，安全）。联网后 `npm i react-markdown remark-gfm` 并按 DocReader 头注释切换 |

---

## 四、守住的约束与已修复项（核验通过 ✅）

- **Q4 不回写 codex**：`characterCard.ts` / `tavern/sync.ts` 全链只读 codex，有测试断言。
- **Q5 单向同步**：`sync.ts` 绝不调 `docsStore.save/remove`；世界书 entry 按 `novelchat.sourceDoc` 幂等，人工维护字段（keys/order/constant/…）永不被覆盖；角色卡仅覆盖 `data.description`。
- **Q9/Q10/Q11 边界**：群组仅 manual|list（natural/pooled 标后置 disabled）；无全局 lorebook；仅 V2 JSON 导入导出。
- **路径穿越防护**：docsStore（null 字节/分隔符/双点拒绝 + resolve 包含校验，保留中文文件名）与 tavernStore（safeSegment+safeFile）双双到位。
- **lorebook 引擎**：递归 2 层防环（matchedIds 去重）、constant 永不被裁、priority 降序保留、insertion_order 最终排序——逻辑正确。
- **上次 code-review（`code-review-report.md`）修复核实**：P0-1 TaskQueue 配置源已修（loadConfig + 入队固化 config）；P1-3 无测试/CI 已补（vitest 90 测 + ci.yml）；tools/prompts/StepOutline 拆分完成。
- **旧组件废弃**：Workspace/AppShell/LeftRail/AgentPanel 已标 DEPRECATED，全仓无活跃路由引用；`/project/[id]` 已改深链重定向。
- **HITL 幂等**：`useChat.confirm(id, true, mdBody)` 回传编辑后正文，runtime apply 一次。

---

## 五、建议收口顺序（给后续工作者）

1. **修 P0-1**：studioActions/BookDetail 的 fs 依赖改走 API 路由 → 跑通 `next build`（这是 Electron 打包链路的前提）。
2. **接真实后端**：ChatStudio 换 `httpChatStream`（P1-1）；presets 路由接 store（P1-2）。
3. **修 P2-1 测试假红 + P2-10 CSS 注释** → `npm test` 全绿（90/90）+ build 无警告。
4. **分批提交 git**（P1-4）：建议顺序 = 存储层(docsStore/tavern) → agent 扩展(md 提案) → studio 组件 → 酒馆 API/UI → 旧组件废弃标记 → 文档；遵循 `feat:`/`docs:` 前缀规范。
5. **文档对齐**：重写 `PROJECT_OVERVIEW.md` / `README.md`（当前仍是 v1.0.0 旧三栏架构 + 「墨章」品牌 + 「无测试框架」等过时表述），对齐新主界面 + Novel&Chat + vitest 现状。
6. **人工验收**：按 `deliverables/software-company/tavern-mvp-manual-test.md` 的 A~I + EC 十组用例逐项勾选（目前均未实测）。
7. 待办不变项：NotoSerifSC.woff2 放入 `electron/fonts/`；lucide-react 二选一收敛（P2-9）。

---

## 六、如何在本机跑验证（实测可用的命令）

```powershell
# 类型检查（当前 0 错误）
node node_modules/typescript/bin/tsc --noEmit

# 测试（.bin/vitest.cmd 缺失，直连入口可跑；当前 89/90，1 假红见 P2-1）
node node_modules/vitest/vitest.mjs run

# 构建（当前失败，见 P0-1）
npm run build

# 建议先 npm ci 修复 node_modules（vitest .bin 缺失是此前离线 npm i 的副作用）
```
