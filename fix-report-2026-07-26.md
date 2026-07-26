# 修复记录（2026-07-26）

> 本文档面向后续工作者，记录针对 `code-review-report-2026-07-26.md` 中全部问题（P0×1 / P1×4 / P2×11）的修复内容、依据与验证结果。阅读顺序建议：先看《调研结论》理解修法依据，再按《修复清单》逐项对照代码。

## 一、GitHub / 社区调研结论（修复依据）

动手前调研了 Next.js 官方文档与 SillyTavern 等同类项目，得到三条直接指导修复的结论：

1. **client 组件禁止 import Node 模块（Next.js 官方共识）**
   `"use client"` 组件的 import 链上不能出现基于 `fs` 的模块。`tsc` 查不出这类问题，只有 `next build`（webpack 打包）会报错。社区标准修法：**数据访问全部下沉到 API 路由，客户端只 `fetch`**。这是 P0-1 的修复方案来源。
2. **SillyTavern 的 presets 就是服务端 JSON 文件落盘**
   预设（preset）没有更复杂的机制，就是按 id 写 JSON 到磁盘 + 列表接口。本项目 `tavernStore` 已具备同构能力，P1-2 直接接通即可，无需新造存储层。
3. **World Info 的 scanDepth = 扫描最近 N 条消息**（`slice(-N)`）
   证实本项目 `lib/roleplay/lorebook.ts` 的实现是**正确**的，假红的是测试（测试把关键词消息放在了"最近端"，导致 scanDepth 裁剪语义验证反了）。修测试，不修实现。

## 二、修复清单

### P0-1：client 组件直连 fs → 构建失败（已修，`next build` 通过）

**问题**：`BookDetail.tsx` / `StudioProvider.tsx`（均为 client 组件）直接 import `lib/studioActions.ts` / `lib/docsStore.ts`，import 链触达 `fs`，`next build` 直接失败。

**修法**（不动 studioActions/docsStore/migrate 本体，保持其可单测；只切断 client → fs 的 import 链）：

| 文件 | 改动 |
| --- | --- |
| `app/api/projects/[id]/docs/route.ts` | **新建**。GET 列表 / `?name=` 单篇；列表为空时服务端做 FT-10 bible→docs 迁移（迁移逻辑从客户端下沉至此） |
| `app/api/studio/confirm-md/route.ts` | **新建**。POST 校验 projectId/draft 后调 `applyMdDraftToStorage`，回传 `ApplyResult` |
| `lib/client.ts` | 新增 `fetchDocs` / `fetchDoc` / `confirmMdRemote` 三个 helper（走 `apiUrl()`，保持云就绪接缝①） |
| `components/studio/BookDetail.tsx` | 三个 useEffect 全改走 fetch；`DocMeta`/`DocRecord` 改 type-only import |
| `components/studio/StudioProvider.tsx` | `confirmMd` 改走 `confirmMdRemote`；新增 `confirmError` state（见 P2-8） |

### P1（4 项，全部完成）

- **P1-1 ChatStudio 永远走 mock**：transport 改为 `hasConfig() ? httpChatStream(getApiBase()) : mockChatStream`（`components/studio/ChatStudio.tsx`）。配置了 LLM 就走真实后端，未配置回退 mock。
- **P1-2 presets 路由全 stub**：`app/api/tavern/presets/route.ts` 重写，GET/POST/DELETE 全接 `tavernStore`；POST 强制注入 `novelchat.ownerId`；GET 支持 `?projectId=` 过滤；DELETE 先读后验归属。`TavernPresetManager.tsx` 摘除全部 stub 文案，接通加载/保存/删除（新增 Trash2 图标于 `components/studio/icons.tsx`）。
- **P1-3 tavern DELETE 越权**：characters / lorebooks / groups 三个路由的 DELETE 统一为"先 read → `novelchat.ownerId` 不匹配返回 403 → 否则幂等删除"（旧数据无 ownerId 放行）。`lib/tavern/store.ts` 为此补齐 `readGroup(id)`（接口 + 实现 + 类注册三处）。
- **P1-4 characters/[codexId] GET 无鉴权**：补 `resolveAuth(req)` + ownerId 校验，不匹配 403。

### P2（11 项：9 修复 + 2 依赖处理）

| 编号 | 问题 | 修法 | 文件 |
| --- | --- | --- | --- |
| P2-1 | lorebook scanDepth 测试假红 | 关键词消息移到数组最旧端（`["这里提到了远古传说", ...25条填充]`），正确验证裁剪语义 | `lib/roleplay/lorebook.test.ts` |
| P2-2 | 写文件非原子，进程中断会写坏 JSON | 先写 `${file}.${ts}.tmp` 再 `fs.rename`（listJson/listDocs 按后缀过滤，.tmp 不会被误读） | `lib/docsStore.ts`、`lib/tavern/store.ts` |
| P2-3 | resolveChapter 零分也模糊兜底 | `bestScore` 从 -1 改 0 起步（零分不采纳）；无信号时仅当全书恰好一章才兜底，否则返回 null | `lib/studioActions.ts` |
| P2-4 | 旧版组件无弃用标记 | 头部加 DEPRECATED 注释，指向 studio 新实现 | `components/StepOutline.tsx`、`StepWriting.tsx` |
| P2-5 | selective 语义注释写反 | 修正注释（selective=true 才要求 secondary 命中） | `lib/roleplay/lorebook.ts` |
| P2-6 | assembleRoleContext 用引用相等排除自身 | 改按 `extensions.novelchat.codexId` 比较，无 codexId 才退回引用相等 | `lib/roleplay/persona.ts` |
| P2-7 | chatFacade confirm 丢弃第三参 mdBody | 补透传（签名 `(proposalId, approved, mdBody?)`） | `components/studio/ChatStudio.tsx` |
| P2-8 | 落稿失败静默无提示 | StudioProvider 新增 `confirmError`，ChatStudio 渲染错误条 | `StudioProvider.tsx`、`ChatStudio.tsx` |
| P2-9 | lucide-react 死依赖（0 引用） | `npm uninstall lucide-react`（removed 28 packages） | `package.json` |
| P2-10 | CSS 注释内 `--space-*/--z-*` 等含 `*/` 序列导致注释提前闭合 | 注释中的变量列举改顿号分隔（两处：L909、L1920 附近） | `app/globals.css` |
| P2-11 | markdown 渲染为自研实现 | `npm i react-markdown remark-gfm` 安装成功，`DocReader.tsx` 切换为 ReactMarkdown（去掉 `dangerouslySetInnerHTML`）；`lib/markdown.ts` 保留为离线兜底 | `components/studio/DocReader.tsx` |

### 顺手修复的潜在 bug（自查发现，不在审查报告中）

- **ChatStudio 把项目 id 当书名**：`bookLabel = selectedBookId` 直接把 id 塞进 seed 文案。已改为经 `fetchProject` 取真实书名（`bookTitle` state）。

## 三、依赖变更

| 操作 | 包 | 原因 |
| --- | --- | --- |
| 移除 | `lucide-react@^0.460.0` | 全仓 0 引用（图标为 `components/studio/icons.tsx` 自绘） |
| 新增 | `react-markdown`、`remark-gfm` | P2-11，社区标准 markdown 渲染栈 |

## 四、验证结果

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `node node_modules/typescript/bin/tsc --noEmit` | ✅ 0 错误 |
| 单元测试 | `node node_modules/vitest/vitest.mjs run` | ✅ 13 文件 / 90 用例全绿（含 lorebook 假红转绿；resolveChapter 新语义下 studioActions 测试仍通过） |
| 生产构建 | `npm run build` | ✅ 通过（修复前因 P0-1 失败），新增两个 API 路由已入产物 |
| 浏览器冒烟 | dev server + 全功能走查 | ✅ 见下 |

**浏览器冒烟测试结论**（dev server + 自动化浏览器走查全部页面）：

- 首页 / 书架（10 本书）/ 设置 / 新书 / 拆书工坊 / 续写导入 / Agent 预览：全部正常渲染，无控制台错误，API 无 4xx/5xx。
- **书详情（P0-1 验收）**：docs 列表与单篇均经 `/api/projects/[id]/docs` 返回 200，DocReader 以 react-markdown 正确渲染富文本。
- **酒馆预设（P1-2 验收）**：presets 列表/新建/删除 CRUD 闭环全部 200，列表实时刷新。
- 对话工作室：已配置 LLM 时走真实后端（P1-1 生效）；上游 key 无效返回 401 时错误内联展示、不白屏。
- 发送按钮点击复验有效（首测"点击无响应"为 HMR 干扰的伪象，代码无问题）。

**冒烟中顺手修复的两个小问题**：

- `app/globals.css` 字体声明加 `local("Noto Serif SC")` 优先——纯浏览器环境下 `app://` 协议必然失败并刷 CORS 控制台错误，现已消除（Electron 环境不受影响）。
- `app/settings/page.tsx` temperature 输入归一到两位小数，避免 float32 精度长尾（如 `0.8500000238…`）入库。

**已确认非问题**：窄视口（≤700px）下左右侧栏隐藏——Electron 主形态有 `minWidth: 960` 兜底，纯浏览器窄屏的响应式适配列为后续优化项。

> 注：`node_modules/.bin/vitest.cmd` 缺失，vitest 需用 `node node_modules/vitest/vitest.mjs run` 直调。

## 五、遗留事项 / 给后续工作者的提示

1. `lib/auth.ts` 的 `resolveAuth` 目前恒返回 `ownerId="local"`（云就绪接缝⑤），所有归属校验逻辑已就位，接入真实鉴权时只需替换该函数。
2. 旧版 tavern 数据（无 `novelchat.ownerId`）在 DELETE 时放行删除，属有意的兼容行为；若需收紧，可在数据迁移补齐 ownerId 后移除放行分支。
3. `lib/markdown.ts` 已无生产消费方，保留作为离线兜底 + 其测试仍在跑；若确认不再需要可删。
4. `components/StepOutline.tsx` / `StepWriting.tsx` 已标 DEPRECATED，确认无入口引用后可整体删除。
