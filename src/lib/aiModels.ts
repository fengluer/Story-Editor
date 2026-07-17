import type { AiModelSettings, AiProjectSettings, AiProviderProtocol, AiProviderSettings } from "../ai/types";

export type AiModelOption = {
  ref: string;
  label: string;
  provider: AiProviderSettings;
  model: AiModelSettings;
};

export type AiProviderPreset = {
  id: string;
  name: string;
  protocol: AiProviderProtocol;
  baseURL: string;
  requiresApiKey: boolean;
  models: AiModelSettings[];
};

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    protocol: "openai-responses",
    baseURL: "https://api.openai.com/v1",
    requiresApiKey: true,
    models: [{ id: "gpt-5.6-luna", name: "GPT-5.6 Luna" }],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    protocol: "openai-chat",
    baseURL: "https://openrouter.ai/api/v1",
    requiresApiKey: true,
    models: [],
  },
  {
    id: "ollama",
    name: "Ollama",
    protocol: "openai-chat",
    baseURL: "http://127.0.0.1:11434/v1",
    requiresApiKey: false,
    models: [],
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    protocol: "openai-chat",
    baseURL: "http://127.0.0.1:1234/v1",
    requiresApiKey: false,
    models: [],
  },
  {
    id: "custom",
    name: "Custom Provider",
    protocol: "openai-chat",
    baseURL: "https://example.com/v1",
    requiresApiKey: true,
    models: [],
  },
];

export function createProviderFromPreset(presetId: string, existingIds: string[]): AiProviderSettings {
  const preset = AI_PROVIDER_PRESETS.find((item) => item.id === presetId) ?? AI_PROVIDER_PRESETS[AI_PROVIDER_PRESETS.length - 1];
  const id = nextProviderId(preset.id, existingIds);
  return {
    id,
    name: preset.name,
    protocol: preset.protocol,
    baseURL: preset.baseURL,
    requiresApiKey: preset.requiresApiKey,
    models: preset.models.map((model) => ({ ...model })),
  };
}

export function modelRef(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

export function listAiModels(settings: Pick<AiProjectSettings, "providers">): AiModelOption[] {
  return settings.providers.flatMap((provider) => provider.models
    .filter((model) => model.id.trim())
    .map((model) => ({
      ref: modelRef(provider.id, model.id),
      label: `${provider.name || provider.id} / ${model.name || model.id}`,
      provider,
      model,
    })));
}

export function resolveAiModel(settings: AiProjectSettings, selection?: string): AiModelOption {
  const target = (selection || settings.defaultModel).trim();
  const match = listAiModels(settings).find((option) => option.ref === target);
  if (!match) {
    throw new Error(target ? `未找到模型配置：${target}` : "请先在 AI 设定中添加并选择默认模型");
  }
  return match;
}

export function validateAiSettings(settings: AiProjectSettings): void {
  if (settings.providers.length === 0) {
    throw new Error("请至少添加一个 Provider");
  }
  const ids = new Set<string>();
  for (const provider of settings.providers) {
    const id = provider.id.trim();
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error(`Provider ID 无效：${provider.id || "空"}`);
    }
    if (ids.has(id)) {
      throw new Error(`Provider ID 重复：${id}`);
    }
    ids.add(id);
    if (!provider.name.trim() || !provider.baseURL.trim()) {
      throw new Error(`Provider ${id} 缺少名称或 Base URL`);
    }
    let baseURL: URL;
    try {
      baseURL = new URL(provider.baseURL);
    } catch {
      throw new Error(`Provider ${id} 的 Base URL 无效`);
    }
    const local = ["localhost", "127.0.0.1", "::1"].includes(baseURL.hostname);
    if (baseURL.protocol !== "https:" && !(baseURL.protocol === "http:" && local)) {
      throw new Error(`Provider ${id} 必须使用 HTTPS，本机地址除外`);
    }
    const modelIds = new Set<string>();
    for (const model of provider.models) {
      const modelId = model.id.trim();
      if (!modelId) {
        throw new Error(`Provider ${id} 存在空的模型 ID`);
      }
      if (modelIds.has(modelId)) {
        throw new Error(`Provider ${id} 的模型 ID 重复：${modelId}`);
      }
      modelIds.add(modelId);
    }
  }
  resolveAiModel(settings);
  if (settings.god.model) {
    resolveAiModel(settings, settings.god.model);
  }
  for (const character of settings.characters) {
    if (character.model) {
      resolveAiModel(settings, character.model);
    }
  }
}

function nextProviderId(base: string, existingIds: string[]): string {
  if (!existingIds.includes(base)) {
    return base;
  }
  let index = 2;
  while (existingIds.includes(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}
