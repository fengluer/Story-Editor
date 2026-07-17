import type { AiApiStatus, AiModelRequest } from "./ai/types";

export {};

declare global {
  type StoryEditorSaveFileResult = {
    saved: boolean;
    canceled?: boolean;
    filePath?: string;
  };

  type StoryEditorFileFilter = {
    name: string;
    extensions: string[];
  };

  interface Window {
    storyEditorClipboard?: {
      readText: () => Promise<string>;
    };
    storyEditorFile?: {
      save: (options: {
        fileName: string;
        data: ArrayBuffer;
        filters?: StoryEditorFileFilter[];
      }) => Promise<StoryEditorSaveFileResult>;
    };
    storyEditorWindow?: {
      focus: () => Promise<boolean>;
    };
    storyEditorAi?: {
      getStatus: () => Promise<AiApiStatus>;
      saveApiKey: (providerId: string, apiKey: string) => Promise<{ saved: boolean; configuredProviderIds: string[] }>;
      generate: <T>(request: AiModelRequest) => Promise<T>;
    };
  }
}
