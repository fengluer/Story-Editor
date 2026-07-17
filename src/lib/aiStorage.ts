import type { AiCharacter, AiProjectSettings, AiProviderProtocol, AiProviderSettings, AiRuntimeState, AiScene } from "../ai/types";
import { createProviderFromPreset, modelRef } from "./aiModels";

const SETTINGS_PREFIX = "story-editor.ai-settings.v1";
const RUNTIME_PREFIX = "story-editor.ai-runtime.v1";
const LEGACY_DEFAULT_GOD_PROMPT = "维持角色的有限视角，推动冲突自然发展，不替角色说话，也不要把一个角色的秘密泄露给另一个角色。";

type LegacyAiSettings = {
  version?: number;
  provider?: { endpoint?: string; model?: string };
  god?: AiProjectSettings["god"];
  characters?: AiCharacter[];
  scenes?: AiScene[];
  activeSceneId?: string;
};

type StoredAiSettings = LegacyAiSettings & Partial<Omit<AiProjectSettings, "version">>;

export function createDefaultAiSettings(): AiProjectSettings {
  const provider = createProviderFromPreset("openai", []);
  return {
    version: 2,
    providers: [provider],
    defaultModel: modelRef(provider.id, provider.models[0].id),
    god: {
      name: "上帝",
      model: "",
      prompt: "",
    },
    characters: [],
    scenes: [],
    activeSceneId: "",
  };
}

export function createEmptyAiRuntime(settings?: AiProjectSettings, useFullStoryContext = false): AiRuntimeState {
  return {
    version: 2,
    sessionId: createAiSessionId(),
    useFullStoryContext,
    events: [],
    characterStates: {},
    directorState: "",
    characterSceneIds: initialCharacterSceneIds(settings),
    activeSceneId: initialActiveSceneId(settings),
  };
}

export function loadAiSettings(sourceName: string): AiProjectSettings {
  try {
    const raw = localStorage.getItem(storageKey(SETTINGS_PREFIX, sourceName));
    if (!raw) {
      return createDefaultAiSettings();
    }
    const parsed = JSON.parse(raw) as StoredAiSettings;
    if (parsed.version === 2 && Array.isArray(parsed.providers)) {
      return normalizeV2Settings(parsed);
    }
    if (parsed.version === 1 && parsed.provider) {
      return migrateV1Settings(parsed);
    }
    return createDefaultAiSettings();
  } catch {
    return createDefaultAiSettings();
  }
}

export function saveAiSettings(sourceName: string, settings: AiProjectSettings): void {
  localStorage.setItem(storageKey(SETTINGS_PREFIX, sourceName), JSON.stringify({ ...settings, version: 2 }));
}

export function loadAiRuntime(sourceName: string, settings?: AiProjectSettings): AiRuntimeState {
  try {
    const raw = localStorage.getItem(storageKey(RUNTIME_PREFIX, sourceName));
    if (!raw) {
      return createEmptyAiRuntime(settings);
    }
    const parsed = JSON.parse(raw) as {
      version?: number;
      events?: AiRuntimeState["events"];
      characterStates?: AiRuntimeState["characterStates"];
      directorState?: string;
      characterSceneIds?: Record<string, string>;
      activeSceneId?: string;
      sessionId?: string;
      useFullStoryContext?: boolean;
    };
    if ((parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.events) || !parsed.characterStates) {
      return createEmptyAiRuntime(settings);
    }
    const storedLocations = parsed.version === 2 && parsed.characterSceneIds && typeof parsed.characterSceneIds === "object"
      ? parsed.characterSceneIds
      : initialCharacterSceneIds(settings);
    const validCharacterIds = new Set(settings?.characters.map((character) => character.id) ?? Object.keys(storedLocations));
    const validSceneIds = new Set(settings?.scenes.map((scene) => scene.id) ?? Object.values(storedLocations));
    const characterSceneIds = Object.fromEntries(Object.entries(storedLocations).filter(([characterId, sceneId]) => validCharacterIds.has(characterId) && validSceneIds.has(sceneId)));
    const initialLocations = initialCharacterSceneIds(settings);
    for (const [characterId, sceneId] of Object.entries(initialLocations)) {
      characterSceneIds[characterId] ??= sceneId;
    }
    return {
      version: 2,
      sessionId: typeof parsed.sessionId === "string" && parsed.sessionId ? parsed.sessionId : createAiSessionId(),
      useFullStoryContext: parsed.useFullStoryContext === true,
      events: parsed.events,
      characterStates: parsed.characterStates,
      directorState: typeof parsed.directorState === "string" ? parsed.directorState : "",
      characterSceneIds,
      activeSceneId: parsed.version === 2 && typeof parsed.activeSceneId === "string" && validSceneIds.has(parsed.activeSceneId)
        ? parsed.activeSceneId
        : initialActiveSceneId(settings),
    };
  } catch {
    return createEmptyAiRuntime(settings);
  }
}

function createAiSessionId(): string {
  return typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function saveAiRuntime(sourceName: string, runtime: AiRuntimeState): void {
  localStorage.setItem(storageKey(RUNTIME_PREFIX, sourceName), JSON.stringify({ ...runtime, version: 2 }));
}

function initialCharacterSceneIds(settings?: AiProjectSettings): Record<string, string> {
  if (!settings) {
    return {};
  }
  const locations: Record<string, string> = {};
  const orderedScenes = [...settings.scenes].sort((left, right) => Number(right.id === settings.activeSceneId) - Number(left.id === settings.activeSceneId));
  for (const scene of orderedScenes) {
    for (const characterId of scene.participantIds) {
      if (!locations[characterId] && settings.characters.some((character) => character.id === characterId)) {
        locations[characterId] = scene.id;
      }
    }
  }
  return locations;
}

function initialActiveSceneId(settings?: AiProjectSettings): string {
  if (!settings || settings.scenes.length === 0) {
    return "";
  }
  return settings.scenes.some((scene) => scene.id === settings.activeSceneId) ? settings.activeSceneId : settings.scenes[0].id;
}

function normalizeV2Settings(parsed: StoredAiSettings): AiProjectSettings {
  const defaults = createDefaultAiSettings();
  const providers = (parsed.providers ?? []).map(normalizeProvider).filter((provider): provider is AiProviderSettings => Boolean(provider));
  return {
    version: 2,
    providers: providers.length > 0 ? providers : defaults.providers,
    defaultModel: typeof parsed.defaultModel === "string" ? parsed.defaultModel : defaults.defaultModel,
    god: normalizeGodSettings(parsed.god, defaults),
    characters: Array.isArray(parsed.characters) ? parsed.characters : [],
    scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
    activeSceneId: typeof parsed.activeSceneId === "string" ? parsed.activeSceneId : "",
  };
}

function normalizeProvider(value: Partial<AiProviderSettings>): AiProviderSettings | null {
  if (!value || typeof value.id !== "string") {
    return null;
  }
  const protocol: AiProviderProtocol = value.protocol === "openai-chat" ? "openai-chat" : "openai-responses";
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : value.id,
    protocol,
    baseURL: typeof value.baseURL === "string" ? value.baseURL : "",
    requiresApiKey: value.requiresApiKey !== false,
    models: Array.isArray(value.models)
      ? value.models.filter((model) => model && typeof model.id === "string").map((model) => ({ id: model.id, name: typeof model.name === "string" ? model.name : model.id }))
      : [],
  };
}

function normalizeGodSettings(god: AiProjectSettings["god"] | undefined, defaults: AiProjectSettings): AiProjectSettings["god"] {
  if (!god) return defaults.god;
  return { ...defaults.god, ...god, prompt: god.prompt === LEGACY_DEFAULT_GOD_PROMPT ? "" : god.prompt };
}

function migrateV1Settings(parsed: LegacyAiSettings): AiProjectSettings {
  const defaults = createDefaultAiSettings();
  const oldModel = String(parsed.provider?.model || defaults.providers[0].models[0].id).trim();
  const oldEndpoint = String(parsed.provider?.endpoint || "https://api.openai.com/v1/responses").trim();
  const legacyModelIds = [oldModel, parsed.god?.model, ...(parsed.characters ?? []).map((character) => character.model)]
    .map((model) => String(model || "").trim())
    .filter((model, index, models) => Boolean(model) && models.indexOf(model) === index);
  const provider: AiProviderSettings = {
    id: "openai",
    name: "OpenAI",
    protocol: "openai-responses",
    baseURL: oldEndpoint.replace(/\/?responses\/?$/i, ""),
    requiresApiKey: true,
    models: legacyModelIds.map((model) => ({ id: model, name: model })),
  };
  const convertModel = (value?: string) => value?.trim() ? modelRef(provider.id, value.trim()) : "";
  return {
    version: 2,
    providers: [provider],
    defaultModel: modelRef(provider.id, oldModel),
    god: { ...normalizeGodSettings(parsed.god, defaults), model: convertModel(parsed.god?.model) },
    characters: Array.isArray(parsed.characters)
      ? parsed.characters.map((character) => ({ ...character, model: convertModel(character.model) }))
      : [],
    scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
    activeSceneId: typeof parsed.activeSceneId === "string" ? parsed.activeSceneId : "",
  };
}

function storageKey(prefix: string, sourceName: string): string {
  return `${prefix}:${encodeURIComponent(sourceName || "story.csv")}`;
}
