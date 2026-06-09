const { contextBridge, ipcRenderer } = require("electron");

const READ_CLIPBOARD_CHANNEL = "story-editor:read-clipboard-text";

contextBridge.exposeInMainWorld("storyEditorClipboard", {
  readText: () => ipcRenderer.invoke(READ_CLIPBOARD_CHANNEL),
});
