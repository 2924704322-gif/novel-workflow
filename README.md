# 墨章 Novel Atelier

本地优先的长篇小说 AI 创作工作流桌面应用。从立意、设定集、分卷脉络，到逐章生成、去 AI 味、全链一致性校对，墨章把长篇写作的完整生产线装进一个可离线运行的桌面程序里。

- 数据全部保存在你自己的电脑上，不上传云端。
- 通过你自备的「OpenAI 兼容」模型接口工作（自选服务商与模型）。
- 打包为 Windows 安装包，双击安装即用。

> 本项目从一个 Next.js Web 应用打包为 Electron 桌面应用。既可作为网页项目开发，也可构建为独立安装包分发。

## 功能亮点

- 立意 / 故事设定集 / 分卷脉络三步向导，逐步解锁、不跳步。
- 逐章正文生成，严格遵循本章脉络（下一章细纲作为负向止步线，防止串章）。
- 设定库（Codex）多因子检索 + 分层滚动前情（卷级 arcSummary、全书 storySoFar）+ 带时间线的状态归档，缓解中期记忆错乱。
- 伏笔全生命周期管理（埋设 / 强化 / 回收 / 废弃）。
- 拆书学文风与设定：从范文提取风格卡、设定卡，注入创作。
- 去 AI 味反套路指令与自定义负面清单。
- 多模型 / 多 API 配置档，可随时切换。

## 下载安装（普通用户）

1. 前往本仓库的 [Releases](../../releases) 页面，下载最新的 `墨章 Novel Atelier Setup x.y.z.exe`。
2. 双击运行安装程序，可自选安装目录，安装完成后从桌面或开始菜单启动「墨章」。
3. 首次启动后，进入应用内「设置」页，填写你的模型接口信息：
   - Base URL（OpenAI 兼容端点，如 `https://api.openai.com/v1` 或你使用的网关地址）
   - API Key
   - 模型名称
4. 配置保存后即可开始创作。

> Windows SmartScreen 提示：本安装包未做代码签名，首次运行可能出现「Windows 已保护你的电脑」提示。点击「更多信息」→「仍要运行」即可。这是未签名开源软件的常见现象。

## 数据存储位置

你的小说、文风卡、设定卡等数据默认保存在系统用户数据目录，而非安装目录，因此卸载/重装应用不会误删作品：

```
%APPDATA%\墨章 Novel Atelier\data\
├── projects\   # 每本小说一个 JSON 文件
├── styles\     # 拆书学文风卡缓存
└── archives\   # 拆书学设定缓存
```

### 自定义存储位置（不占用 C 盘）

如果不想把数据放在 C 盘，可在应用顶部菜单 **数据 → 更改数据存储位置…** 选择任意磁盘上的文件夹。选定后：

- 数据会存到你所选目录下的 `墨章数据\` 子文件夹；
- 若已有作品，会询问是否一并复制过去（原数据保留，确认无误后可自行删除）；
- 设置立即持久化（仅在 `%APPDATA%` 留一个几字节的指针文件 `data-location.json`），重启后生效；
- 菜单 **数据 → 打开当前数据文件夹** 可随时定位实际存储位置。

也可在启动前通过环境变量 `NOVEL_DATA_ROOT` 强制指定根目录（优先级最高）。

模型接口配置（含 API Key）保存在应用内置浏览器的本地存储中，不写入上述数据文件，也不会随作品导出。

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

该命令会同时启动 `next dev` 并在就绪后打开 Electron 窗口（开发模式直接连 `http://localhost:3000`）。

### 构建 Windows 安装包

```powershell
npm run app:build
# 产物输出到 dist\，如 dist\墨章 Novel Atelier Setup 1.0.0.exe
```

构建流程：`next build`（standalone 输出）→ 复制静态资源进 standalone → `electron-builder` 打包 NSIS 安装包。

### 把构建缓存放到非系统盘（可选，保护 C 盘空间）

Electron 运行时与 electron-builder 的缓存默认下载到 C 盘 `%LOCALAPPDATA%`（约 1–2 GB）。若 C 盘空间紧张，可在**安装依赖和构建之前**把缓存指向其他磁盘：

```powershell
$env:ELECTRON_CACHE = "E:\.ecache"
$env:ELECTRON_BUILDER_CACHE = "E:\.ecache"
npm install
npm run app:build
```

仓库还提供了一个内置了上述缓存路径（`E:/.ecache`）的便捷脚本：

```powershell
npm run app:build:win
```

## 自动发布（CI）

推送以 `v` 开头的 tag（如 `v1.0.0`）会触发 GitHub Actions 在 `windows-latest` 上构建安装包，并把 `.exe` 上传到对应的 GitHub Release。

```powershell
git tag v1.0.0
git push origin v1.0.0
```

工作流定义见 [.github/workflows/release.yml](.github/workflows/release.yml)。

## 技术栈

- Next.js 15（App Router，Route Handlers）
- React 19 + TypeScript
- Tailwind CSS 4
- 纯文件 JSON 存储（无数据库）
- Electron + electron-builder（桌面打包）

## 架构要点

- 服务端 API 路由通过 OpenAI 兼容接口以流式方式生成内容；密钥仅存于本地。
- 生产环境由 Electron 主进程 fork 启动 Next.js standalone 服务，加载到应用窗口。
- 数据目录通过环境变量 `NOVEL_DATA_ROOT` 注入，桌面版指向用户可写目录。

## 许可协议

[MIT](LICENSE)
