import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiProjectSettings } from "../ai/types";
import { createProviderFromPreset, listAiModels, resolveAiModel, validateAiSettings } from "./aiModels";
import { loadAiSettings } from "./aiStorage";

function settings(): AiProjectSettings {
  return {
    version: 2,
    providers: [
      { id: "openai", name: "OpenAI", protocol: "openai-responses", baseURL: "https://api.openai.com/v1", requiresApiKey: true, models: [{ id: "gpt-test", name: "GPT Test" }] },
      { id: "local", name: "Local", protocol: "openai-chat", baseURL: "http://127.0.0.1:11434/v1", requiresApiKey: false, models: [{ id: "writer", name: "Writer" }] },
    ],
    defaultModel: "openai/gpt-test",
    god: { name: "Director", model: "local/writer", prompt: "Direct" },
    characters: [],
    scenes: [],
    activeSceneId: "",
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenCode-style AI model configuration", () => {
  it("lists and resolves provider/model references", () => {
    const value = settings();
    expect(listAiModels(value).map((option) => option.ref)).toEqual(["openai/gpt-test", "local/writer"]);
    expect(resolveAiModel(value).provider.id).toBe("openai");
    expect(resolveAiModel(value, value.god.model).provider.protocol).toBe("openai-chat");
    expect(() => validateAiSettings(value)).not.toThrow();
  });

  it("gives duplicate presets stable provider IDs", () => {
    expect(createProviderFromPreset("openai", ["openai", "openai-2"]).id).toBe("openai-3");
  });

  it("rejects a selected model that is absent from the provider registry", () => {
    const value = settings();
    value.god.model = "local/missing";
    expect(() => validateAiSettings(value)).toThrow("local/missing");
  });

  it("migrates legacy endpoint and model settings without losing overrides", () => {
    const data = new Map<string, string>();
    data.set("story-editor.ai-settings.v1:story.csv", JSON.stringify({
      version: 1,
      provider: { endpoint: "https://api.openai.com/v1/responses", model: "gpt-legacy" },
      god: { name: "Director", model: "gpt-director", prompt: "Direct" },
      characters: [{ id: "a", name: "A", roleId: "a", model: "gpt-character", position: "l", persona: "", speakingStyle: "", privateGoal: "", motivation: "", secrets: "", initialMemory: "" }],
      scenes: [],
      activeSceneId: "",
    }));
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    });

    const migrated = loadAiSettings("story.csv");
    expect(migrated.version).toBe(2);
    expect(migrated.providers[0].baseURL).toBe("https://api.openai.com/v1");
    expect(migrated.defaultModel).toBe("openai/gpt-legacy");
    expect(migrated.god.model).toBe("openai/gpt-director");
    expect(migrated.characters[0].model).toBe("openai/gpt-character");
  });
});
