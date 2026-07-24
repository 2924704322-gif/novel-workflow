// Preload script (contextIsolation: true).
//
// Intentionally minimal: 墨章 runs entirely over local HTTP, so the renderer
// needs no privileged bridge today. This file is the reserved seam for any
// future IPC (e.g. native file dialogs, export-to-folder) exposed via
// contextBridge.exposeInMainWorld.
