# 墨章 Novel Atelier

本地优先的长篇小说 AI 创作工作流桌面应用。从立意、设定集、分卷脉络，到逐章生成、去 AI 味、全链一致性校对，墨章把长篇写作的完整生产线装进一个可离线运行的桌面程序里。

- 数据全部保存在你自己的电脑上，不上传云端。
- 通过你自备的「OpenAI 兼容」模型接口工作（自选服务商与模型）。
- 打包为 Windows 安装包，双击安装即用。

> 本项目从 Next.js Web 应用打包为 Electron 桌面应用。既可作为网页项目开发，也可构建为独立安装包分发。

## 功能亮点

**创作核心**
- 立意 / 故事设定集 / 分卷脉络三步向导，逐步解锁、不跳步
- 逐章正文生成，严格遵循本章脉络（下一章细纲作为负向止步线，防止串章）
- 设定库（Codex）多因子检索 + 分层滚动前情 + 带时间线的状态归档
- 伏笔全生命周期管理（埋设 / 强化 / 回收 / 废弃）
- 去 AI 味反套路指令与自定义负面清单
- 方向驱动重生 + 每本书独立提示词库

**AI Agent**
- 对话式 Agent，自然语言驱动全部创作操作（17+4 个工具）
- 6 个内置技能（一键续写 / 续写+归档 / 规划分卷 / 展开细纲 / 一致性统一 / 梳理前情）
- Human-in-the-loop：所有写操作需确认后方可落库

**角色对话**
- 酒馆式沉浸角色对话（1v1 + 多角色轮转）
- 三种轮转模式：自动轮转 / 手动指定 / 旁白驱动
- 角色人设自动从设定库组装

**拆书工坊**
- 拆书学文风：从范文提取 7 维文风规则卡，注入后续创作
- 拆书学设定：从范文抽取完整世界观/人物/主线，一键二创开新书
- 卡库管理 + 可编辑 + 多张文风卡融合

**工程能力**
- 章节版本历史：自动快照 + 行级 Diff + 一键回滚
- 导出：EPUB / Markdown / TXT（Web 下载 + 桌面原生保存）
- 任务队列：批量续写 / 批量归档 / 全链流水线，断点续跑 + 指数退避重试
- 多模型 / 多 API 配置档，随时切换

## 下载安装（普通用户）

1. 前往本仓库的 [Releases](../../releases) 页面，下载最新的 `墨章 Novel Atelier Setup x.y.z.exe`。
2. 双击运行安装程序，可自选安装目录，安装完成后从桌面或开始菜单启动「墨章」。
3. 首次启动后，进入应用内「设置」页，填写你的模型接口信息：
   - Base URL（OpenAI 兼容端点，如 `https://api.deepseek.com/v1`）
   - API Key
   - 模型名称（如 `deepseek-chat`）
4. 配置保存后即可开始创作。

> **Windows SmartScreen 提示**：本安装包未做代码签名，首次运行可能出现「Windows 已保护你的电脑」提示。点击「更多信息」→「仍要运行」即可。

## 数据存储位置

你的小说、文风卡、设定卡等数据默认保存在系统用户数据目录（非安装目录），卸载/重装不会误删作品：

```
%APPDATA%\墨章 Novel Atelier\data\
├── projects\     # 每本小说一个 JSON 文件
├── styles\       # 文风卡缓存
├── archives\     # 设定卡缓存
├── chats\        # Agent 对话会话
├── roleplay\     # 角色对话会话
├── history\      # 章节版本快照
└── queue\        # 任务队列数据
```

### 自定义存储位置

菜单 **数据 → 更改数据存储位置…** 可选择任意磁盘。也可通过环境变量 `NOVEL_DATA_ROOT` 强制指定（优先级最高）。

## 开发者：本地运行与构建

### 环境要求

- Node.js ≥ 18（推荐 20+）
- Windows（构建 Windows 安装包）

### 安装依赖

```powershell
npm install
```

### 以网页方式开发

```powershell
npm run dev
# 浏览器打开 http://localhost:3000
```

### 以桌面方式开发（Electron 窗口）

```powershell
npm run electron:dev
```

### 构建 Windows 安装包

```powershell
npm run app:build:win
# 产物: dist\墨章 Novel Atelier Setup 1.0.0.exe (~145MB)
```

构建流程：`next build`（standalone）→ 复制静态资源 → `electron-builder`（NSIS 安装包）。

国内网络已配置 npmmirror 镜像，无需翻墙即可构建。

### TypeScript 类型检查

```powershell
npx tsc --noEmit
```

## 自动发布（CI）

推送 `v*` tag 会触发 GitHub Actions 自动构建并上传到 Release：

```powershell
git tag v1.0.0
git push origin v1.0.0
```

## 技术栈

- **框架**：Next.js 15 (App Router) + React 19 + TypeScript 5 (strict)
- **样式**：Tailwind CSS 4 + CSS 变量设计系统
- **桌面**：Electron 33 + electron-builder 25 (NSIS)
- **存储**：纯 JSON 文件（无数据库）
- **模型**：OpenAI 兼容接口（SSE 流式）
- **导出**：epub-gen-memory（纯 JS，无 native 依赖）

## 架构要点

- 服务端 API 路由通过 OpenAI 兼容接口以流式方式生成内容；密钥仅存于浏览器本地
- 生产环境由 Electron 主进程 fork Next.js standalone 服务，分配随机端口加载到窗口
- Agent 系统采用工具循环 + Human-in-the-loop 确认流，写操作必须用户授权
- 版本历史在 save_project 落库前自动拍摄章节快照
- 任务队列支持断点续跑，每步完成即持久化 checkpoint
- 数据目录可迁移至任意磁盘，通过 IPC 弹出原生对话框选择

## 详细技术文档

完整的架构设计、数据模型、API 列表、核心机制说明、预留接口、开发约定等，请参见 [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)。

## 许可协议

[MIT](LICENSE)
