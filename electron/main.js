// Electron main process for 墨章 Novel Atelier.
//
// In production we launch the Next.js standalone server (produced by
// `next build` with output:"standalone") as a child process on a free local
// port, then point a BrowserWindow at it. In development we simply attach to
// the running `next dev` server on :3000.
//
// Data is stored under a configurable root (passed to the server via
// NOVEL_DATA_ROOT) because the install directory is usually read-only. The
// root defaults to app.getPath("userData")/data on the system drive, but the
// user can relocate it to any disk via the "数据 → 更改数据存储位置…" menu; we
// then persist only a tiny pointer file in userData.

const { app, BrowserWindow, shell, dialog, Menu, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const net = require("net");
const { fork } = require("child_process");

const isDev = !app.isPackaged;
const DEV_URL = "http://localhost:3000";

let serverProcess = null;
let mainWindow = null;
let currentDataRoot = null;

// Only one instance may run: it owns the local server/port.
const gotLock = app.requestSingleInstanceLock();

// Ask the OS for an available TCP port on the loopback interface.
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Poll the server until it answers, so we don't load a blank page too early.
function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.destroy();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error("Next 服务启动超时"));
        } else {
          setTimeout(tryOnce, 300);
        }
      });
    };
    tryOnce();
  });
}

// ── Data location ──────────────────────────────────────────────────────────
// The novel data root is configurable so it need not live on the system drive.
// We persist only a tiny pointer file in userData; the actual data can sit on
// any disk the user chooses via the "数据 → 更改数据存储位置…" menu.

function locationConfigPath() {
  return path.join(app.getPath("userData"), "data-location.json");
}

function readSavedDataRoot() {
  try {
    const { dataRoot } = JSON.parse(fs.readFileSync(locationConfigPath(), "utf-8"));
    if (typeof dataRoot === "string" && dataRoot.trim()) return dataRoot;
  } catch {
    // no pointer yet or unreadable — fall back to the default
  }
  return null;
}

function saveDataRoot(dataRoot) {
  fs.writeFileSync(locationConfigPath(), JSON.stringify({ dataRoot }, null, 2), "utf-8");
}

// Resolve the effective data root. Priority: explicit env override →
// user-chosen folder → default <userData>/data on the system drive.
function resolveDataRoot() {
  const fromEnv = process.env.NOVEL_DATA_ROOT;
  if (fromEnv && fromEnv.trim()) return fromEnv;
  return readSavedDataRoot() || path.join(app.getPath("userData"), "data");
}

// Let the user pick a new folder, optionally copy existing novels over, then
// relaunch so the forked server picks up the new NOVEL_DATA_ROOT.
async function changeDataLocation() {
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: "选择数据存储位置",
    defaultPath: currentDataRoot || app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"],
  });
  if (picked.canceled || picked.filePaths.length === 0) return;

  // Nest under a named subfolder so we never clutter (or later delete) the
  // folder the user selected, and the data can be moved as one unit.
  const newRoot = path.join(picked.filePaths[0], "墨章数据");
  if (path.resolve(newRoot) === path.resolve(currentDataRoot || "")) return;

  const hasExisting =
    !!currentDataRoot &&
    fs.existsSync(currentDataRoot) &&
    fs.readdirSync(currentDataRoot).length > 0;

  let copyExisting = false;
  if (hasExisting) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: ["复制现有数据到新位置", "仅切换，不复制", "取消"],
      defaultId: 0,
      cancelId: 2,
      message: "是否把现有作品数据复制到新位置？",
      detail: `当前：${currentDataRoot}\n新位置：${newRoot}\n\n复制后原数据仍会保留，确认无误后可自行删除。`,
    });
    if (response === 2) return;
    copyExisting = response === 0;
  }

  try {
    fs.mkdirSync(newRoot, { recursive: true });
    if (copyExisting) fs.cpSync(currentDataRoot, newRoot, { recursive: true });
  } catch (err) {
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      message: "设置数据位置失败",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  saveDataRoot(newRoot);

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "info",
    buttons: ["立即重启", "稍后"],
    defaultId: 0,
    message: "数据存储位置已更新，重启后生效。",
    detail: newRoot,
  });
  if (response === 0) {
    app.relaunch();
    app.exit(0);
  }
}

// Native menu; the 数据 submenu is where users manage the storage location.
function buildMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: "数据",
      submenu: [
        { label: "更改数据存储位置…", click: () => changeDataLocation() },
        {
          label: "打开当前数据文件夹",
          click: () => currentDataRoot && shell.openPath(currentDataRoot),
        },
        { type: "separator" },
        { role: "quit", label: "退出" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "刷新" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "重置缩放" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

async function startProdServer() {
  const dataRoot = currentDataRoot || resolveDataRoot();
  currentDataRoot = dataRoot;
  fs.mkdirSync(dataRoot, { recursive: true });

  const standaloneDir = path.join(__dirname, "..", ".next", "standalone");
  const serverJs = path.join(standaloneDir, "server.js");
  const port = await getFreePort();

  serverProcess = fork(serverJs, [], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NOVEL_DATA_ROOT: dataRoot,
      // Run the forked Electron binary as plain Node.
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });

  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url);
  return url;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "墨章 Novel Atelier",
    backgroundColor: "#faf6f0",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open external links (e.g. docs) in the system browser, not new windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  try {
    const url = isDev ? DEV_URL : await startProdServer();
    await mainWindow.loadURL(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await mainWindow.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          `<body style="font-family:sans-serif;padding:2rem;background:#faf6f0">` +
            `<h2>启动失败</h2><p>${message}</p></body>`
        )
    );
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────
// Native file operations exposed via contextBridge (see preload.js).

function registerIpcHandlers() {
  // Save file: shows native save dialog, writes data to user-chosen path.
  ipcMain.handle("save-file", async (_event, defaultName, data) => {
    const ext = path.extname(defaultName).replace(".", "");
    const filters = [];
    if (ext === "epub") filters.push({ name: "EPUB 电子书", extensions: ["epub"] });
    else if (ext === "md") filters.push({ name: "Markdown", extensions: ["md"] });
    else if (ext === "txt") filters.push({ name: "纯文本", extensions: ["txt"] });
    filters.push({ name: "所有文件", extensions: ["*"] });

    const result = await dialog.showSaveDialog(mainWindow, {
      title: "导出作品",
      defaultPath: defaultName,
      filters,
    });

    if (result.canceled || !result.filePath) {
      return { success: false };
    }

    try {
      fs.writeFileSync(result.filePath, Buffer.from(data));
      return { success: true, filePath: result.filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

function cleanup() {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch {
      // already gone
    }
    serverProcess = null;
  }
}

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    currentDataRoot = resolveDataRoot();
    buildMenu();
    registerIpcHandlers();
    createWindow();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on("window-all-closed", () => {
    cleanup();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", cleanup);
}
