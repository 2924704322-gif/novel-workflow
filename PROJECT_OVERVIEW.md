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
│   ├── project/[id]/page.tsx      # 作品工作区入口（薄壳，渲染 Workspace）
│   └── api/
│       ├── projects/route.ts          # GET 列表 / POST 新建
│       ├── projects/[id]/route.ts     # GET / PUT / DELETE 单个作品
│       └── generate/
│           ├── outline/route.ts       # 生成故事圣经 + 分卷（JSON）
│           ├── volume/route.ts        # 展开单卷为章节脉络（JSON）
│           ├── chapter/route.ts       # 生成单章正文（流式）
│           └── digest/route.ts        # 章节归档：抽取摘要/设定/伏笔（JSON）
├── components/
│   ├── TopBar.tsx                 # 顶栏（含配置快速切换）
│   ├── ProfileSwitcher.tsx        # 顶栏 API 配置档下拉切换
│   ├── Workspace.tsx              # 工作区：两步导航 + 进度 + 自动保存（防抖）
│   ├── StepOutline.tsx            # 第一步：立意/大纲/分卷/逐章脉络编辑
│   ├── StepWriting.tsx            # 第二步：逐章写作、连写、导出、就地改脉络
│   └── CodexPanel.tsx             # 设定库 + 伏笔表的管理面板
├── lib/
│   ├── types.ts                   # 全部数据模型与工具函数（单一数据源）
│   ├── llm.ts                     # OpenAI 兼容流式/非流式调用封装
│   ├── prompts.ts                 # 所有提示词构造（架构/展开/写作/归档）
│   ├── retrieval.ts               # 连贯性检索：设定命中、近章摘要、伏笔、归档回填
│   ├── storage.ts                 # 服务端项目文件读写 + 字段回填迁移
│   └── client.ts                  # 客户端：配置档管理 + REST/流式 fetch 封装
├── data/projects/*.json           # 每部作品的持久化数据
├── start-dev.bat                  # Windows 一键启动
└── next.config.mjs
```

---

## 5. 核心数据模型（`lib/types.ts`）

一部作品是一个 `Project`，随 `phase` 在两阶段流转，整体序列化为一个 JSON：

- **`Project`**：`setup`（创作设定）、`bible`（故事圣经）、`volumes[]`（分卷→章节树）、`codex[]`（设定库）、`foreshadows[]`（伏笔表）。
- **`ProjectSetup`**：题材、灵感、主角、文风、**内容分级 `rating`**、目标总字数、单章字数、**预设总章节数 `targetChapters`**、**去 AI 味 `deAi` + 负面清单 `bannedList`**、其他要求。
- **`StoryBible`**：logline、梗概、世界观、主题、文风视角、人物表。
- **`Volume` / `Chapter`**：卷含 `plannedChapters` 与 `chapters[]`；章含 `synopsis`（脉络）、`content`（正文）、`summary`（成稿摘要，供跨章续写用）、`status`（empty/draft/done）。
- **`CodexEntry`**：设定库条目（人物/地点/物品/势力/设定/其他），含别名（用于检索命中）与「更新于第几章」。
- **`Foreshadow`**：伏笔，四状态 `planted / reinforced / paid / abandoned`，记录埋设章与回收章。

> `types.ts` 同时是工具函数中心：`countWords`、`projectStats`、`emptyProject`、`toSummary`、`DEFAULT_SETUP`、各枚举常量。**改数据结构从这里开始。**

---

## 6. 三大核心机制

### 6.1 两级大纲 + 逐章脉络（可控篇幅）
- **Level 1**：`buildBiblePrompt` 生成圣经 + 分卷。卷数由「预设总章节数」或「目标字数 ÷ 12 万」推算；各卷 `chapterCount` 之和向总章数看齐。
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
`setup.deAi` 开启后注入硬性反套路指令：禁对仗式强行升华、禁排比堆砌、禁段尾/章末空洞抒情、少用空泛形容词与网文陈词、对话要有潜台词与停顿……并支持用户自定义**负面清单**。

### 6.5 内容分级与创作意图（`RATING_GUIDANCE`）
四档分级（全年龄/青年/成人·严肃文学/成人·R18）会向模型**声明合法创作意图**，减少正常虚构剧情被误判拒绝。R18 档带硬护栏（全部角色成年、情节自愿、不涉未成年）。
> 注意：这是**创作定位声明，非越狱**。能否落地取决于所连模型/接口的策略，官方严格服务仍可能拦截。

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
| `/api/generate/outline` | POST | 生成故事圣经 + 分卷（返回 JSON） |
| `/api/generate/volume` | POST | 展开单卷为章节脉络（返回 JSON） |
| `/api/generate/chapter` | POST | 生成单章正文（**text/plain 流式**） |
| `/api/generate/digest` | POST | 章节归档，抽取摘要/设定/伏笔（返回 JSON） |

- 生成类接口 `dynamic = "force-dynamic"`、`maxDuration = 600`。
- API Key 由前端随请求体传入，服务端仅透传给模型接口，不落盘。
- `lib/llm.ts` 负责 Base URL 归一化、SSE 解析、流式/非流式两种消费方式；`extractJson`（`prompts.ts`）容错解析被 ``` 包裹或夹带解释的模型输出。

---

## 9. 数据流一览

```
新建作品 → StepOutline 填写 setup
   → /api/generate/outline  → bible + volumes（写回 project）
   → 逐卷 /api/generate/volume → chapters 脉络
   → 人工增删改分卷/章节脉络
→ 进入 StepWriting 逐章：
   buildChapterContext(检索设定/摘要/伏笔) → /api/generate/chapter(流式) → 正文
   → /api/generate/digest → applyDigest 回填 codex/foreshadows/summary
→ Workspace 防抖(900ms) PUT /api/projects/[id] 持久化
→ 「导出」把全部已写章节拼为 .txt 下载
```

---

## 10. 约定与注意事项（给二次开发者）

- **数据结构单一来源**：改模型先动 `lib/types.ts`；`storage.ts` 的 `normalizeProject` 负责为旧存档回填新字段，加字段时记得在此兜底，避免旧作品报错。
- **提示词集中在 `lib/prompts.ts`**：调风格/结构/约束在这里改，与 UI 解耦。
- **检索是确定性的**：`retrieval.ts` 用子串匹配而非 embedding；若要升级为向量检索，替换 `selectRelevantCodex` 即可，接口保持不变。
- **SSR 水合**：`ProfileSwitcher` 等客户端专属组件用 `mounted` 守卫延迟渲染，改动时注意别引入水合不一致。
- **不可变更新 + reindex**：增删卷/章后统一重排 `index` 保持序号连续。
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
