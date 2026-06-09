export {};

declare global {
  interface Window {
    storyEditorClipboard?: {
      readText: () => Promise<string>;
    };
  }
}
