const { contextBridge, ipcRenderer } = require("electron");

const READ_CLIPBOARD_CHANNEL = "story-editor:read-clipboard-text";
const SAVE_FILE_CHANNEL = "story-editor:save-file";
const FOCUS_WINDOW_CHANNEL = "story-editor:focus-window";
const AI_STATUS_CHANNEL = "story-editor:ai-status";
const AI_SAVE_KEY_CHANNEL = "story-editor:ai-save-key";
const AI_GENERATE_CHANNEL = "story-editor:ai-generate";

contextBridge.exposeInMainWorld("storyEditorClipboard", {
  readText: () => ipcRenderer.invoke(READ_CLIPBOARD_CHANNEL),
});

contextBridge.exposeInMainWorld("storyEditorFile", {
  save: (options) => ipcRenderer.invoke(SAVE_FILE_CHANNEL, options),
});

contextBridge.exposeInMainWorld("storyEditorWindow", {
  focus: () => ipcRenderer.invoke(FOCUS_WINDOW_CHANNEL),
});

contextBridge.exposeInMainWorld("storyEditorAi", {
  getStatus: () => ipcRenderer.invoke(AI_STATUS_CHANNEL),
  saveApiKey: (providerId, apiKey) => ipcRenderer.invoke(AI_SAVE_KEY_CHANNEL, { providerId, apiKey }),
  generate: (request) => ipcRenderer.invoke(AI_GENERATE_CHANNEL, request),
});
