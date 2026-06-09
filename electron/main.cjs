const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const READ_CLIPBOARD_CHANNEL = "story-editor:read-clipboard-text";
const SAVE_FILE_CHANNEL = "story-editor:save-file";
const FOCUS_WINDOW_CHANNEL = "story-editor:focus-window";

function focusWindow(window) {
  if (!window) {
    return;
  }

  window.show();
  window.focus();
  window.webContents.focus();
}

function bufferFromPayload(payload) {
  const data = payload?.data;
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (Array.isArray(data)) {
    return Buffer.from(data);
  }
  if (typeof data === "string") {
    return Buffer.from(data, payload.encoding === "base64" ? "base64" : "utf8");
  }
  throw new Error("Unsupported file data");
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: "#f3f5f8",
    title: "Story Editor",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  });
  window.setMenuBarVisibility(false);

  if (isDev) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ipcMain.handle(READ_CLIPBOARD_CHANNEL, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    focusWindow(window);
    return clipboard.readText();
  });
  ipcMain.handle(SAVE_FILE_CHANNEL, async (event, payload) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      defaultPath: payload?.fileName || "story.csv",
      filters: payload?.filters || [],
    };
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      focusWindow(window);
      return { saved: false, canceled: true };
    }

    await fs.writeFile(result.filePath, bufferFromPayload(payload));
    focusWindow(window);
    return { saved: true, filePath: result.filePath };
  });
  ipcMain.handle(FOCUS_WINDOW_CHANNEL, (event) => {
    focusWindow(BrowserWindow.fromWebContents(event.sender));
    return true;
  });
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
