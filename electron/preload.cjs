const { contextBridge, ipcRenderer } = require("electron");

const READ_CLIPBOARD_CHANNEL = "story-editor:read-clipboard-text";
const SAVE_FILE_CHANNEL = "story-editor:save-file";
const FOCUS_WINDOW_CHANNEL = "story-editor:focus-window";

contextBridge.exposeInMainWorld("storyEditorClipboard", {
  readText: () => ipcRenderer.invoke(READ_CLIPBOARD_CHANNEL),
});

contextBridge.exposeInMainWorld("storyEditorFile", {
  save: (options) => ipcRenderer.invoke(SAVE_FILE_CHANNEL, options),
});

contextBridge.exposeInMainWorld("storyEditorWindow", {
  focus: () => ipcRenderer.invoke(FOCUS_WINDOW_CHANNEL),
});
