# 墨章 · Novel Atelier —— 项目总览

> 面向「百万字长篇小说」的本地 AI 创作工作流。从立意、大纲、分卷/章节脉络，到逐章成文、连贯性维护，一站式完成。

本文档用于帮助后续开发者（含 Qoder 用户）快速理解项目结构、核心机制与扩展点，便于二次加工。

---

## 1. 项目定位

一个**单人本地使用**的长篇小说创作台：接入任意 **OpenAI 兼容**的大模型接口（DeepSeek / OpenAI / 各类中转 API 等），把「百万字连载」拆解为可控的两级流程：

1. **立意 · 大纲**：由灵感生成故事圣经（Story Bible）+ 分卷规划 → 逐卷展开为章节脉络。
2. **铺陈 · 正文**：以「大纲 + 检索到的相关设定 + 前情摘要 + 待回收伏笔」为上下文，逐章流式生成正文。

核心要解决的难题是：**上下文长度有限，如何让百万字保持前后连贯、人物/设定不崩、伏笔有始有终、且读起来不像 AI。**

---

## 2. 技术栈

| 层面 | 选型 |
| --- | --- |
| 框架 | Next.js 15.5.4（App Router + Route Handlers） |
| UI 运行时 | React 19 |
| 语言 | TypeScript 5（strict），路径别名 `@/*` |
| 样式 | Tailwind CSS v4（`@tailwindcss/postcss`）+ 自定义 CSS 变量设计系统 |
| 数据持久化 | 服务端：每部作品一个 JSON 文件（`data/projects/*.json`）；客户端：`localStorage` 存 API 配置 |
| 模型接入 | OpenAI 兼容 `/chat/completions`，SSE 流式 |
| 运行环境 | 纯本地，无数据库、无外部服务依赖 |

依赖极简：生产依赖仅 `next` / `react` / `react-dom`。

---

## 3. 快速开始

```bash
# 首次
npm install

# 开发（http://localhost:3000）
npm run dev

# 生产构建 / 启动
npm run build
npm run start
```

Windows 用户可直接双击根目录 `start-dev.bat`：自动检测并安装依赖、启动 dev server、延时打开浏览器。

**首次使用**：进入「接口设置」页填写 Base URL、API Key、模型名与温度。配置存于浏览器 `localStorage`，不上传服务器。

---

## 4. 目录结构

```
novel-workflow/
├── app/
│   ├── layout.tsx                 # 根布局、字体、全局样式挂载
│   ├── page.tsx                   # 首页「书房」：作品列表 / 新建 / 删除
│   ├── globals.css                # 设计系统（深墨蓝 + 朱砂红「书斋朱印」主题）
│   ├── settings/page.tsx          # 多模型/API 配置管理器
│   ├── style/page.tsx             # 拆书工坊：学文风（文风卡）/ 拆设定（作品档案→二创开新书）双标签
│   ├── project/[id]/page.tsx      # 作品工作区入口（薄壳，渲染 Workspace）
│   └── api/
│       ├── projects/route.ts          # GET 列表 / POST 新建
│       ├── projects/[id]/route.ts     # GET / PUT / DELETE 单个作品
│       ├── style-analyze/route.ts     # 分析单个文本块（文风）
│       ├── styles/route.ts            # GET 文风卡库列表
│       ├── styles/[hash]/route.ts     # 文风规则卡缓存 GET / PUT
│       ├── archive-analyze/route.ts   # 分析单个文本块（作品设定）
│       ├── archive-reduce/route.ts    # 全书综合：多块档案归并为一张作品档案
│       ├── archives/route.ts          # GET 作品档案卡库列表
│       ├── archives/[hash]/route.ts   # 作品档案卡缓存 GET / PUT
│       └── generate/
│           ├── bible/route.ts         # 生成故事设定集（JSON）
│           ├── volumes/route.ts       # 据定稿设定集规划分卷（JSON）
│           ├── volume/route.ts        # 展开单卷为章节脉络（JSON）
│           ├── chapter-outline/route.ts # 重生单章脉络（JSON）
│           ├── chapter/route.ts       # 生成单章正文（流式）
│           ├── digest/route.ts        # 章节归档：抽取摘要/设定/伏笔（JSON）
│           └── reconcile/route.ts     # 重生成后全链一致性统一校订（JSON）
├── components/
│   ├── TopBar.tsx                 # 顶栏（含配置快速切换）
│   ├── ProfileSwitcher.tsx        # 顶栏 API 配置档下拉切换
│   ├── Workspace.tsx              # 工作区：两步导航 + 进度 + 自动保存（防抖）+ 就地改书名
│   ├── StepOutline.tsx            # 第一步：立意/大纲/分卷/逐章脉络编辑 + 方向驱动重生
│   ├── StepWriting.tsx            # 第二步：逐章写作、连写、导出、就地改脉络 + 提示词库/设定库/伏笔面板
│   ├── ArchiveResult.tsx          # 作品档案卡展示 + 「以此开新书」
│   ├── CardLibrary.tsx            # 文风卡 / 作品档案卡的卡库列表管理
│   ├── ChangeSummary.tsx          # 重生成后「全链一致性统一」变更摘要面板
│   ├── PromptLibrary.tsx          # 每本书独立的提示词库面板
│   └── CodexPanel.tsx             # 设定库 + 伏笔表的管理面板
├── lib/
│   ├── types.ts                   # 全部数据模型与工具函数（单一数据源）
│   ├── llm.ts                     # OpenAI 兼容流式/非流式调用封装
│   ├── prompts.ts                 # 所有提示词构造（架构/展开/写作/归档/文风分析/一致性统一）
│   ├── retrieval.ts               # 连贯性检索：设定命中、近章摘要、伏笔、归档回填
│   ├── reconcile.ts               # 重生成后全链一致性统一：收集下游 → 请求校订 → 回写
│   ├── style.ts                   # 拆书学文风：分块/采样/哈希/多块确定性合并
│   ├── archive.ts                 # 拆书学设定：档案归一化/合并 + 二创开新书 seed
│   ├── parseNovel.ts              # 导入 .txt 长文按「第N章」切分为卷/章结构
│   ├── encoding.ts                # 中文文本文件编码探测与健壮解码
│   ├── storage.ts                 # 服务端项目 + 文风卡 + 作品档案文件读写 + 字段回填
│   └── client.ts                  # 客户端：配置档管理 + REST/流式 fetch 封装
├── data/projects/*.json           # 每部作品的持久化数据
├── data/styles/*.json             # 文风规则卡缓存（按范文哈希）
├── data/archives/*.json           # 作品档案卡缓存（按范文哈希）
├── start-dev.bat                  # Windows 一键启动
└── next.config.mjs
```

---

## 5. 核心数据模型（`lib/types.ts`）

一部作品是一个 `Project`，随 `phase` 在两阶段流转，整体序列化为一个 JSON：

- **`Project`**：`setup`（创作设定）、`bible`（故事圣经）、`volumes[]`（分卷→章节树）、`codex[]`（设定库）、`foreshadows[]`（伏笔表）、**`prompts[]`（本书独立提示词库）**。
- **`ProjectSetup`**：题材、灵感、主角、文风、**内容分级 `rating`**、目标总字数、单章字数、**预设总章节数 `targetChapters`**、**去 AI 味 `deAi` + 负面清单 `bannedList`**、**已应用文风卡 `styleCards[]`（多选；旧版单张 `styleCard` 兼容保留）**、其他要求。
- **`StoryBible`**：logline、梗概、世界观、主题、文风视角、人物表。
- **`Volume` / `Chapter`**：卷含 `plannedChapters` 与 `chapters[]`；章含 `synopsis`（脉络）、`content`（正文）、`summary`（成稿摘要，供跨章续写用）、`status`（empty/draft/done）。
- **`CodexEntry`**：设定库条目（人物/地点/物品/势力/设定/其他），含别名（用于检索命中）与「更新于第几章」。
- **`Foreshadow`**：伏笔，四状态 `planted / reinforced / paid / abandoned`，记录埋设章与回收章。
- **`PromptEntry`**：提示词库条目，含 `source`（manual/bible/volumes/chapter-outline/prose 五类来源）、`content`（诉求/方向文本）、`note`（如“第12章”）、`enabled`（是否参与后续生成）。带方向的重生会自动入库并去重。
- **`StyleCard`**：拆书学文风产出的 7 维文风规则卡（另带一条综合各维度的「模仿指南 `signature`」），可写入 `setup.styleCards` 作为写作硬约束（多张时融合模仿）；高频词与禁用词均不含人名/称谓/专有名词，支持在拆书工坊内新建自定义卡及就地编辑。
- **`StoryArchive`**：拆书学设定产出的作品档案（作品名/梗概/世界观/力量体系/主题/文风提示 + `ArchiveCharacter[]` 人物 / `ArchiveEntry[]` 地点与势力 / `mainPlot[]` 主线），经 `seedProjectFromArchive` 折叠为一部可写作的 `Project`。

> `types.ts` 同时是工具函数中心：`countWords`、`projectStats`、`emptyProject`、`toSummary`、`effectiveStyleCards`（多选文风卡回退）、`recordPromptEntry`/`enabledPrompts`（提示词库）、`DEFAULT_SETUP`、各枚举常量。**改数据结构从这里开始。**

---

## 6. 核心机制

### 6.1 三步立意向导 + 两级大纲（可控篇幅）
- **顺序向导**：`StepOutline` 把立意阶段拆成三步，须上一步完成才解锁下一步——① 创作设定（填 setup，至少有题材或核心灵感）→ ② 故事设定集（生成/校订 `bible`）→ ③ 分卷脉络（据定稿 bible 规划 volumes 并逐卷展开章节）。
- **Level 1a**：`buildBiblePrompt` 仅生成故事设定集（logline/梗概/世界观/主题/基调/主要人物），不含分卷。
- **Level 1b**：`buildVolumesPrompt(setup, bible)` 以定稿设定集为上下文规划分卷。卷数由「预设总章节数」或「目标字数 ÷ 12 万」推算；各卷 `chapterCount` 之和向总章数看齐。
- **Level 2**：`buildVolumeChaptersPrompt` 把单卷展开为指定章数的章节脉络。
- **人工介入**：`StepOutline` 支持增删分卷、逐卷调整章节数、**逐章编辑标题/脉络/增删/排序**；`StepWriting` 可在正文页就地改本章脉络，双向即时同步（共用同一 `project` 数据）。

### 6.2 连贯性检索（`lib/retrieval.ts`，解决跨卷失忆）
写每一章前，`buildChapterContext` 组装一小份**高相关上下文**，而非灌入全部历史：
- **设定命中**：以本章标题+脉络+近章摘要为「查询」，对 `codex` 做**别名/关键词子串匹配**打分（无需向量/额外模型调用，确定性强、快），取 Top-N 注入。
- **前情回顾**：取目标章之前最近 4 章的 `summary`，形成滚动「故事梗概」。
- **待回收伏笔**：注入所有 `planted/reinforced` 的伏笔，提醒铺垫或回收。

### 6.3 写后归档（`digest`，让设定库/伏笔表自动生长）
每章写完（可自动或手动）调用 `/api/generate/digest`：模型读正文，抽取**本章摘要 + 设定更新 + 伏笔动向**。`applyDigest` 以**同名合并**（codex 按 name、伏笔按 title）回填，避免重复累积，实现「越写档案越全」。

### 6.4 去 AI 味（`deAiBlock`）
`setup.deAi` 开启后注入**分类硬性反套路指令**，取材自维基百科「Signs of AI writing」的 24 类 AI 写作特征、并针对中文小说正文调校：① 禁 AI 腔句式（对仗升华、否定排比、三段式并列、含糊归因与限定堆砌）；② 回避一份高频「AI 腔词」黑名单（缓缓/微微/嘴角勾起/五味杂陈/仿佛/这一刻/彰显…）；③ 禁「同义词循环」换称指代；④ 节奏与标点克制（长短交错、破折号/省略号/感叹号节制、不每段以景物情绪收尾）；⑤ 段尾章末禁强行抒情点题；⑥ 对话要有个体差异与潜台词；⑦ 正向要求「鲜活」——用具体细节替代抽象概括、人物要有态度、允许适度粗糙。并支持用户自定义**负面清单**追加。

### 6.5 内容分级与创作意图（`RATING_GUIDANCE`）
四档分级（全年龄/青年/成人·严肃文学/成人·R18）会向模型**声明合法创作意图**，减少正常虚构剧情被误判拒绝。R18 档带硬护栏（全部角色成年、情节自愿、不涉未成年）。
> 注意：这是**创作定位声明，非越狱**。能否落地取决于所连模型/接口的策略，官方严格服务仍可能拦截。

### 6.6 拆书学文风（`lib/style.ts` + `/style`，模仿目标文风）
上传一部 `.txt` 范文，让模型产出结构化「文风规则卡」并注入后续写作，形成「学 → 用」闭环：
- **客户端编排**：`/style` 页先 `hashText`（FNV-1a，因浏览器 `SubtleCrypto` 无 md5）算内容指纹查缓存；未命中则 `chunkText`（按段落约 8000 字/块）→ `sampleChunks`（均匀采样含首块，最多 8 块）→ 逐块串行 POST `/api/style-analyze`，显示「第 N/M 块」进度。
- **确定性合并**：`mergeStyleChunks` 免二次 LLM——数值取均值、类别多数投票、数组并集按频率截断、模仿指南取最详尽的一条，汇成一张 `StyleCard`（7 维：句式节奏 / 词汇特征 / 描写策略 / 对话风格 / 叙事结构 / 情绪基调 / 修辞偏好，另含模仿指南）。其中词汇特征的高频词只取风格实词，严禁人名/地名/专有名词。
- **可编辑**：文风卡展示区可点「编辑」就地修改各维度字段（模仿指南/高频词/禁用词/例句等），保存回写 `data/styles/<hash>.json` 并刷新卡库。
- **缓存**：以文件哈希为键存 `data/styles/<hash>.json`（`GET/PUT /api/styles/[hash]`），同一范文秒回。
- **添加（多选）**：可导出 `.json`，或「应用到当前作品」追加写入 `setup.styleCards[]`（支持多张同时生效，旧版单张 `styleCard` 仍兼容）；`effectiveStyleCards` 优先取多选集合，`styleCardBlock` 随后把它们融合为写作硬约束注入 `buildChapterPrompt`（与去 AI 味并列，冲突时以规则卡为准）。除拆书产出外，可在 `CardLibrary` 卡库新建自定义文风卡。写作页顶部显示「文风·XX」标记提示已生效。

### 6.7 拆书学设定·二创开新书（`lib/archive.ts` + `/style` 拆设定标签）
与拆书学文风共用同一条管线（分块/采样/哈希/缓存），但抽取的是**作品档案**而非文风，目标是从一本书**一键二创开新书**：
- **入口**：`/style` 页顶部「学文风 / 拆设定」双标签共用上传区；拆设定逐块串行 POST `/api/archive-analyze`（镜像 `/style-analyze`）。
- **9 维抽取**：作品名 / 整体梗概 / 世界观 / 力量体系与世界规则 / 核心主题基调 / 文风提示 / 主要人物 / 关键地点与势力 / 主线剧情脉络。
- **确定性合并**：`mergeArchiveChunks` 叙事字段取最长、人物/地点/势力按名并集、主线按时序去重，汇成一张 `StoryArchive`。
- **缓存**：存 `data/archives/<hash>.json`（`GET/PUT /api/archives/[hash]`），与文风卡分目录互不冲突。
- **二创开新书**：`seedProjectFromArchive` 新建一部作品——世界观/力量体系写入故事圣经，人物/地点/势力写入设定库，`phase="outline"` 后跳转到该作品。原作主线仅作**参考条目**（写入 codex 与 `setup.extra`），不强塞为新剧情，用户可在大纲页自由发展。

### 6.8 每本书独立提示词库（`PromptLibrary` + `recordPromptEntry`/`enabledPrompts`）
每部作品自带一份 `prompts[]` 提示词库，沉淀用户历次的创作诉求：
- **自动入库**：在大纲/正文阶段带**调整方向**重生时，`recordPromptEntry` 按 `source`（bible/volumes/chapter-outline/prose）自动收录方向文本并**去重置顶**（同来源同内容不重复堆积）。
- **手动管理**：`PromptLibrary` 面板可新增/编辑/启用停用/删除（`source=manual`）。
- **参与生成**：`enabledPrompts` 只取已启用且非空的条目，随各生成接口（bible/volume/chapter 等）一并注入，让风格偏好跨章持续生效。

### 6.9 重生成后全链一致性统一（`lib/reconcile.ts` + `/api/generate/reconcile`）
重写某章后，下游已成稿可能与新内容矛盾。开启后自动修补：
- **收集下游**：`collectDownstream` 取被改章之后的已完成章节。
- **请求校订**：`requestReconcile` 把原/新章摘要与下游章摘要送入 `/api/generate/reconcile`，模型产出需调整的章节及改动点。
- **回写 + 变更摘要**：`applyReconcile` 回写下游章，`ChangeSummary` 面板展示本次全链变更，供用户复核。

### 6.10 方向驱动式重生成
大纲与正文的每一次重生都可附一句「调整方向」（如“节奏再快一点”“弱化感情线”）：方向文本作为额外约束随本次请求注入，同时经 `recordPromptEntry` 入库（见 6.8），既影响当次产出，也沉淀为可复用的长期风格偏好。

---

## 7. 多模型/API 配置档（`lib/client.ts`）

- 支持保存多个命名配置档 `ApiProfile`，存于 `localStorage`（key `novel-workflow.apiProfiles`）。
- 首次运行自动把旧单配置迁移为「默认配置」（`migrateOrSeed`）。
- 顶栏 `ProfileSwitcher` 下拉即时切换，跨标签页同步（监听 `storage` / `focus`）。
- 设置页为完整增删改查 + 设为当前 + 测试连接。
- **向后兼容**：`loadConfig()`/`saveConfig()` 保持原签名，内部委托当前激活档，全站生成逻辑无需感知配置档存在。

---

## 8. 服务端 API（App Router Route Handlers）

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/api/projects` | GET / POST | 作品列表 / 新建 |
| `/api/projects/[id]` | GET / PUT / DELETE | 读取 / 保存 / 删除单部作品 |
| `/api/generate/bible` | POST | 生成故事设定集（返回 JSON） |
| `/api/generate/volumes` | POST | 据定稿设定集规划分卷（返回 JSON） |
| `/api/generate/volume` | POST | 展开单卷为章节脉络（返回 JSON） |
| `/api/generate/chapter-outline` | POST | 重生单章脉络（返回 JSON） |
| `/api/generate/chapter` | POST | 生成单章正文（**text/plain 流式**） |
| `/api/generate/digest` | POST | 章节归档，抽取摘要/设定/伏笔（返回 JSON） |
| `/api/generate/reconcile` | POST | 重生后全链一致性统一校订（返回 JSON） |
| `/api/style-analyze` | POST | 分析单个文本块，返回该块文风分析（客户端负责分块/合并） |
| `/api/styles` | GET | 文风卡库列表 |
| `/api/styles/[hash]` | GET / PUT | 按文件哈希读取 / 写入缓存的文风规则卡 |
| `/api/archive-analyze` | POST | 分析单个文本块，返回该块作品设定抽取（世界观/人物/主线） |
| `/api/archive-reduce` | POST | 全书综合：多块档案归并为一张作品档案（返回 JSON） |
| `/api/archives` | GET | 作品档案卡库列表 |
| `/api/archives/[hash]` | GET / PUT | 按文件哈希读取 / 写入缓存的作品档案卡 |

- 生成类接口 `dynamic = "force-dynamic"`、`maxDuration = 600`。
- API Key 由前端随请求体传入，服务端仅透传给模型接口，不落盘。
- `lib/llm.ts` 负责 Base URL 归一化、SSE 解析、流式/非流式两种消费方式；`extractJson`（`prompts.ts`）容错解析被 ``` 包裹或夹带解释的模型输出。

---

## 9. 数据流一览

```
新建作品 → StepOutline 三步向导
   第1步 填写 setup（可应用多张文风卡 styleCards）
   第2步 → /api/generate/bible   → bible（写回 project）
   第3步 → /api/generate/volumes → volumes（写回 project）
   → 逐卷 /api/generate/volume → chapters 脉络
   → 人工增删改分卷/章节脉络（可带方向重生，方向入提示词库）
→ 进入 StepWriting 逐章：
   buildChapterContext(检索设定/摘要/伏笔) + enabledPrompts → /api/generate/chapter(流式) → 正文
   → /api/generate/digest → applyDigest 回填 codex/foreshadows/summary
   → （重写章节时）/api/generate/reconcile → applyReconcile 统一下游已成稿
→ 连续生成：runAuto 串行下传最新快照（working），逐章函数式合并写回，互不覆盖
→ Workspace 防抖(900ms) PUT /api/projects/[id] 持久化（卸载前补 flush）
→ 「导出」把全部已写章节拼为 .txt 下载
```

---

## 10. 约定与注意事项（给二次开发者）

- **数据结构单一来源**：改模型先动 `lib/types.ts`；`storage.ts` 的 `normalizeProject` 负责为旧存档回填新字段，加字段时记得在此兜底，避免旧作品报错。
- **提示词集中在 `lib/prompts.ts`**：调风格/结构/约束在这里改，与 UI 解耦。
- **检索是确定性的**：`retrieval.ts` 用子串匹配而非 embedding；若要升级为向量检索，替换 `selectRelevantCodex` 即可，接口保持不变。
- **SSR 水合**：`ProfileSwitcher` 等客户端专属组件用 `mounted` 守卫延迟渲染，改动时注意别引入水合不一致。
- **不可变更新 + reindex**：增删卷/章后统一重排 `index` 保持序号连续。
- **状态写回用函数式合并，勿用陈旧快照整体覆盖**：Workspace 的 `patch((p) => updater(p))` 基于最新状态叠加。在 async 循环（如连续生成）中切勿用闭包捕获的陈旧 `project` prop 算出整棵树再 `patch(() => snapshot)` 整体替换——会抹掉循环内先写的章节；应通过返回值串行下传最新快照。组件卸载前需 `flush` 补存，防 900ms 防抖窗口内离开丢正文。
- **环境**：Windows PowerShell 不支持 `&&`，多命令用 `;`。中文写入源码建议用字面字符，避免手写 unicode 转义打错码点。
- **无测试框架**：当前项目未内置单测；验证以 `npm run build` 通过 + 手动回归为主。

---

## 11. 可扩展方向（备忘）

- 向量检索 / 语义召回替代关键词匹配，提升长程一致性。
- 章节级版本历史与差异对比。
- 多人物关系图谱、时间线视图。
- 导出为 EPUB / Markdown / 分卷文件。
- 生成任务队列与断点续跑、失败重试。
- 服务端配置加密存储（当前 Key 仅存浏览器）。

---

*本文件由项目梳理自动生成，供理解与二次加工参考。若结构有较大调整，请同步更新本文件。*
