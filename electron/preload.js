// Preload script (contextIsolation: true).
//
// 墨章 runs entirely over local HTTP. This bridge exposes minimal IPC for
// features that require native OS integration (file save dialogs, etc).

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * 弹出原生"保存文件"对话框并写入数据。
   * @param {string} defaultName - 默认文件名（含扩展名）
   * @param {Uint8Array} data - 文件内容
   * @returns {Promise<{success: boolean, filePath?: string}>}
   */
  saveFile: (defaultName, data) =>
    ipcRenderer.invoke("save-file", defaultName, data),
});
