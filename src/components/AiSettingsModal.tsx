import { Bot, KeyRound, MapPin, Plus, Save, Trash2, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { AiApiStatus, AiCharacter, AiProjectSettings, AiProviderSettings, AiScene } from "../ai/types";
import { AI_PROVIDER_PRESETS, createProviderFromPreset, listAiModels } from "../lib/aiModels";

type AiSettingsTab = "connection" | "god" | "characters" | "scenes";

export function AiSettingsModal({
  settings,
  apiStatus,
  language,
  onClose,
  onSave,
}: {
  settings: AiProjectSettings;
  apiStatus: AiApiStatus;
  language: "zh" | "en";
  onClose: () => void;
  onSave: (settings: AiProjectSettings, apiKeys: Record<string, string>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AiProjectSettings>(() => structuredClone(settings));
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<AiSettingsTab>("connection");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(draft, apiKeys);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text(language, "保存 AI 设定失败", "Failed to save AI settings"));
    } finally {
      setSaving(false);
    }
  }

  function addCharacter() {
    const character = createCharacter(draft.characters);
    setDraft((current) => ({ ...current, characters: [...current.characters, character] }));
  }

  function updateCharacter(id: string, patch: Partial<AiCharacter>) {
    setDraft((current) => ({
      ...current,
      characters: current.characters.map((character) => character.id === id ? { ...character, ...patch } : character),
    }));
  }

  function removeCharacter(id: string) {
    setDraft((current) => ({
      ...current,
      characters: current.characters.filter((character) => character.id !== id),
      scenes: current.scenes.map((scene) => ({ ...scene, participantIds: scene.participantIds.filter((participantId) => participantId !== id) })),
    }));
  }

  function addScene() {
    const scene = createScene(draft.scenes);
    setDraft((current) => ({
      ...current,
      scenes: [...current.scenes, scene],
      activeSceneId: current.activeSceneId || scene.id,
    }));
  }

  function updateScene(id: string, patch: Partial<AiScene>) {
    setDraft((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id === id ? { ...scene, ...patch } : scene),
    }));
  }

  function removeScene(id: string) {
    setDraft((current) => {
      const scenes = current.scenes.filter((scene) => scene.id !== id);
      return { ...current, scenes, activeSceneId: current.activeSceneId === id ? (scenes[0]?.id ?? "") : current.activeSceneId };
    });
  }

  return (
    <div className="ai-modal-backdrop" role="presentation">
      <section className="ai-modal ai-settings-modal" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
        <header className="ai-modal-header">
          <div>
            <span className="ai-modal-kicker"><Bot size={15} aria-hidden="true" /> AI</span>
            <h2 id="ai-settings-title">{text(language, "AI 设定", "AI Settings")}</h2>
            <p>{text(language, "配置上帝、角色的私有动机和场景参与者。", "Configure the director, private character motives, and scene participants.")}</p>
          </div>
          <button type="button" className="icon-button" title={text(language, "关闭", "Close")} onClick={onClose} disabled={saving}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="ai-settings-layout">
          <nav className="ai-settings-nav" aria-label={text(language, "AI 设定分类", "AI setting categories")}>
            <SettingsTab active={tab === "connection"} icon={KeyRound} label={text(language, "模型连接", "Connection")} onClick={() => setTab("connection")} />
            <SettingsTab active={tab === "god"} icon={Bot} label={text(language, "上帝 AI", "Director AI")} onClick={() => setTab("god")} />
            <SettingsTab active={tab === "characters"} icon={Users} label={text(language, `角色 (${draft.characters.length})`, `Characters (${draft.characters.length})`)} onClick={() => setTab("characters")} />
            <SettingsTab active={tab === "scenes"} icon={MapPin} label={text(language, `场景 (${draft.scenes.length})`, `Scenes (${draft.scenes.length})`)} onClick={() => setTab("scenes")} />
          </nav>

          <div className="ai-settings-content">
            {tab === "connection" && (
              <ConnectionSettings draft={draft} apiKeys={apiKeys} apiStatus={apiStatus} language={language} onApiKeysChange={setApiKeys} onChange={setDraft} />
            )}
            {tab === "god" && <GodSettings draft={draft} language={language} onChange={setDraft} />}
            {tab === "characters" && (
              <CharacterSettings settings={draft} language={language} onAdd={addCharacter} onChange={updateCharacter} onRemove={removeCharacter} />
            )}
            {tab === "scenes" && (
              <SceneSettings
                settings={draft}
                language={language}
                onAdd={addScene}
                onChange={updateScene}
                onRemove={removeScene}
                onActiveChange={(activeSceneId) => setDraft((current) => ({ ...current, activeSceneId }))}
              />
            )}
          </div>
        </div>

        <footer className="ai-modal-footer">
          <span className={error ? "ai-error" : "ai-helper"}>{error || text(language, "API Key 只保存到 Electron 的系统加密存储，不写入剧情草稿。", "The API key is kept in Electron system-encrypted storage, not in the story draft.")}</span>
          <div>
            <button type="button" onClick={onClose} disabled={saving}>{text(language, "取消", "Cancel")}</button>
            <button type="button" className="ai-primary-button" onClick={() => void save()} disabled={saving}>
              <Save size={16} aria-hidden="true" />
              {saving ? text(language, "保存中…", "Saving…") : text(language, "保存设定", "Save Settings")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ConnectionSettings({
  draft,
  apiKeys,
  apiStatus,
  language,
  onApiKeysChange,
  onChange,
}: {
  draft: AiProjectSettings;
  apiKeys: Record<string, string>;
  apiStatus: AiApiStatus;
  language: "zh" | "en";
  onApiKeysChange: (value: Record<string, string>) => void;
  onChange: (settings: AiProjectSettings) => void;
}) {
  const [presetId, setPresetId] = useState("openai");
  const modelOptions = listAiModels(draft);

  function addProvider() {
    const provider = createProviderFromPreset(presetId, draft.providers.map((item) => item.id));
    const defaultModel = draft.defaultModel || (provider.models[0] ? `${provider.id}/${provider.models[0].id}` : "");
    onChange({ ...draft, providers: [...draft.providers, provider], defaultModel });
  }

  function updateProvider(id: string, patch: Partial<AiProviderSettings>) {
    onChange({ ...draft, providers: draft.providers.map((provider) => provider.id === id ? { ...provider, ...patch } : provider) });
  }

  function removeProvider(id: string) {
    const providers = draft.providers.filter((provider) => provider.id !== id);
    const remainingModels = listAiModels({ providers });
    const keepModel = (value: string) => value.startsWith(`${id}/`) ? "" : value;
    onChange({
      ...draft,
      providers,
      defaultModel: draft.defaultModel.startsWith(`${id}/`) ? (remainingModels[0]?.ref ?? "") : draft.defaultModel,
      god: { ...draft.god, model: keepModel(draft.god.model) },
      characters: draft.characters.map((character) => ({ ...character, model: keepModel(character.model) })),
    });
  }

  function addModel(provider: AiProviderSettings) {
    let index = provider.models.length + 1;
    while (provider.models.some((model) => model.id === `model-${index}`)) index += 1;
    updateProvider(provider.id, { models: [...provider.models, { id: `model-${index}`, name: "" }] });
  }

  function updateModel(provider: AiProviderSettings, index: number, patch: { id?: string; name?: string }) {
    const oldModel = provider.models[index];
    const models = provider.models.map((model, modelIndex) => modelIndex === index ? { ...model, ...patch } : model);
    const oldRef = `${provider.id}/${oldModel.id}`;
    const newRef = `${provider.id}/${patch.id ?? oldModel.id}`;
    const replaceRef = (value: string) => value === oldRef ? newRef : value;
    onChange({
      ...draft,
      providers: draft.providers.map((item) => item.id === provider.id ? { ...item, models } : item),
      defaultModel: replaceRef(draft.defaultModel),
      god: { ...draft.god, model: replaceRef(draft.god.model) },
      characters: draft.characters.map((character) => ({ ...character, model: replaceRef(character.model) })),
    });
  }

  function removeModel(provider: AiProviderSettings, index: number) {
    const removedRef = `${provider.id}/${provider.models[index].id}`;
    const providers = draft.providers.map((item) => item.id === provider.id ? { ...item, models: item.models.filter((_, modelIndex) => modelIndex !== index) } : item);
    const remainingModels = listAiModels({ providers });
    const clearRef = (value: string) => value === removedRef ? "" : value;
    onChange({
      ...draft,
      providers,
      defaultModel: draft.defaultModel === removedRef ? (remainingModels[0]?.ref ?? "") : draft.defaultModel,
      god: { ...draft.god, model: clearRef(draft.god.model) },
      characters: draft.characters.map((character) => ({ ...character, model: clearRef(character.model) })),
    });
  }

  return (
    <section className="ai-settings-section">
      <div className="ai-section-heading">
        <div><h3>{text(language, "Provider 与模型", "Providers & Models")}</h3><p>{text(language, "像 OpenCode 一样按 Provider 管理连接，并使用 provider/model 选择模型。", "Manage connections by provider and select models using provider/model, like OpenCode.")}</p></div>
        <div className="ai-provider-add"><select value={presetId} onChange={(event) => setPresetId(event.target.value)}>{AI_PROVIDER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><button type="button" onClick={addProvider}><Plus size={16} aria-hidden="true" />{text(language, "添加", "Add")}</button></div>
      </div>
      <label className="ai-default-model">{text(language, "默认模型", "Default model")}<select value={draft.defaultModel} onChange={(event) => onChange({ ...draft, defaultModel: event.target.value })}><option value="">{text(language, "请选择模型", "Select a model")}</option>{modelOptions.map((option) => <option key={option.ref} value={option.ref}>{option.ref} · {option.label}</option>)}</select></label>
      <div className="ai-card-list ai-provider-list">
        {draft.providers.map((provider) => {
          const configured = apiStatus.configuredProviderIds.includes(provider.id);
          return <article className="ai-config-card ai-provider-card" key={provider.id}>
            <div className="ai-card-title"><strong>{provider.name || provider.id}</strong><code>{provider.id}</code><span className={`ai-status ${configured || !provider.requiresApiKey ? "ready" : ""}`}>{!provider.requiresApiKey ? text(language, "无需密钥", "No key required") : configured ? text(language, "密钥已配置", "Key configured") : text(language, "未配置密钥", "No API key")}</span><button type="button" className="icon-button danger" title={text(language, "删除 Provider", "Delete provider")} disabled={draft.providers.length === 1} onClick={() => removeProvider(provider.id)}><Trash2 size={15} aria-hidden="true" /></button></div>
            <div className="ai-form-grid compact">
              <label>{text(language, "显示名称", "Display name")}<input value={provider.name} onChange={(event) => updateProvider(provider.id, { name: event.target.value })} /></label>
              <label>{text(language, "协议", "Protocol")}<select value={provider.protocol} onChange={(event) => updateProvider(provider.id, { protocol: event.target.value === "openai-chat" ? "openai-chat" : "openai-responses" })}><option value="openai-responses">OpenAI Responses</option><option value="openai-chat">OpenAI-compatible Chat</option></select></label>
              <label className="wide">Base URL<input value={provider.baseURL} placeholder="https://api.example.com/v1" onChange={(event) => updateProvider(provider.id, { baseURL: event.target.value })} /></label>
              <label className="ai-inline-checkbox"><input type="checkbox" checked={provider.requiresApiKey} onChange={(event) => updateProvider(provider.id, { requiresApiKey: event.target.checked })} />{text(language, "需要 API Key", "Requires API key")}</label>
              {provider.requiresApiKey && <label>{text(language, "API Key", "API key")}<input type="password" autoComplete="off" value={apiKeys[provider.id] ?? ""} placeholder={configured ? text(language, "留空保留现有密钥", "Leave empty to keep current key") : "sk-…"} onChange={(event) => onApiKeysChange({ ...apiKeys, [provider.id]: event.target.value })} /></label>}
            </div>
            <div className="ai-model-list-heading"><strong>{text(language, "模型清单", "Models")}</strong><button type="button" onClick={() => addModel(provider)}><Plus size={14} aria-hidden="true" />{text(language, "添加模型", "Add model")}</button></div>
            {provider.models.length === 0 ? <div className="ai-empty-state compact">{text(language, "请添加此 Provider 可用的模型 ID。", "Add a model ID available from this provider.")}</div> : <div className="ai-model-list">{provider.models.map((model, index) => <div className="ai-model-row" key={`${provider.id}-${index}`}><label>{text(language, "模型 ID", "Model ID")}<input value={model.id} placeholder="model-id" onChange={(event) => updateModel(provider, index, { id: event.target.value })} /></label><label>{text(language, "显示名称（可选）", "Display name (optional)")}<input value={model.name} onChange={(event) => updateModel(provider, index, { name: event.target.value })} /></label><button type="button" className="icon-button danger" title={text(language, "删除模型", "Delete model")} onClick={() => removeModel(provider, index)}><Trash2 size={15} aria-hidden="true" /></button></div>)}</div>}
          </article>;
        })}
      </div>
      {!apiStatus.available && <p className="ai-warning">{apiStatus.message || text(language, "请使用 Electron 桌面版调用 AI。", "Use the Electron desktop app to call AI.")}</p>}
    </section>
  );
}

function GodSettings({ draft, language, onChange }: { draft: AiProjectSettings; language: "zh" | "en"; onChange: (settings: AiProjectSettings) => void }) {
  const models = listAiModels(draft);
  return (
    <section className="ai-settings-section">
      <div className="ai-section-heading"><div><h3>{text(language, "上帝 AI", "Director AI")}</h3><p>{text(language, "填写故事背景与大纲供上帝 AI 把握全局；角色视角隔离、剧情推进与收束规则由系统自动处理。", "Provide the story background and outline so the director can understand the whole story. Character perspective, progression, and conclusion rules are handled automatically.")}</p></div></div>
      <div className="ai-form-grid">
        <label>{text(language, "名称", "Name")}<input value={draft.god.name} onChange={(event) => onChange({ ...draft, god: { ...draft.god, name: event.target.value } })} /></label>
        <label>{text(language, "专用模型", "Model override")}<select value={draft.god.model} onChange={(event) => onChange({ ...draft, god: { ...draft.god, model: event.target.value } })}><option value="">{text(language, `继承默认（${draft.defaultModel || "未选择"}）`, `Use default (${draft.defaultModel || "not selected"})`)}</option>{models.map((option) => <option key={option.ref} value={option.ref}>{option.ref}</option>)}</select></label>
        <label className="wide">{text(language, "故事背景与大纲", "Story background & outline")}<textarea rows={8} value={draft.god.prompt} placeholder={text(language, "填写世界观、时代背景、核心冲突、关键剧情节点和整体走向。无需编写 AI 指令。", "Describe the setting, time period, central conflict, key plot beats, and overall direction. No AI instructions are needed.")} onChange={(event) => onChange({ ...draft, god: { ...draft.god, prompt: event.target.value } })} /></label>
      </div>
    </section>
  );
}

function CharacterSettings({
  settings,
  language,
  onAdd,
  onChange,
  onRemove,
}: {
  settings: AiProjectSettings;
  language: "zh" | "en";
  onAdd: () => void;
  onChange: (id: string, patch: Partial<AiCharacter>) => void;
  onRemove: (id: string) => void;
}) {
  const characters = settings.characters;
  const models = listAiModels(settings);
  return (
    <section className="ai-settings-section">
      <div className="ai-section-heading">
        <div><h3>{text(language, "角色 AI", "Character AIs")}</h3><p>{text(language, "每个角色拥有独立的人设、目标、秘密和记忆。", "Each character has an isolated persona, goal, secrets, and memory.")}</p></div>
        <button type="button" onClick={onAdd}><Plus size={16} aria-hidden="true" />{text(language, "添加角色", "Add Character")}</button>
      </div>
      {characters.length === 0 ? <EmptyState text={text(language, "还没有角色。添加角色后才能让 AI 编写对话。", "No characters yet. Add one before generating dialogue.")} /> : (
        <div className="ai-card-list">
          {characters.map((character, index) => (
            <article className="ai-config-card" key={character.id}>
              <div className="ai-card-title"><strong>{character.name || text(language, `角色 ${index + 1}`, `Character ${index + 1}`)}</strong><code>{character.id}</code><button type="button" className="icon-button danger" title={text(language, "删除角色", "Delete character")} onClick={() => onRemove(character.id)}><Trash2 size={15} aria-hidden="true" /></button></div>
              <div className="ai-form-grid compact">
                <label>{text(language, "角色名", "Name")}<input value={character.name} onChange={(event) => onChange(character.id, { name: event.target.value })} /></label>
                <label>{text(language, "剧情表人物 ID", "Story role ID")}<input value={character.roleId} onChange={(event) => onChange(character.id, { roleId: event.target.value })} /></label>
                <label>{text(language, "专用模型", "Model override")}<select value={character.model} onChange={(event) => onChange(character.id, { model: event.target.value })}><option value="">{text(language, `继承默认（${settings.defaultModel || "未选择"}）`, `Use default (${settings.defaultModel || "not selected"})`)}</option>{models.map((option) => <option key={option.ref} value={option.ref}>{option.ref}</option>)}</select></label>
                <label>{text(language, "对话位置", "Dialogue position")}<select value={character.position} onChange={(event) => onChange(character.id, { position: event.target.value === "r" ? "r" : "l" })}><option value="l">{text(language, "左侧", "Left")}</option><option value="r">{text(language, "右侧", "Right")}</option></select></label>
                <label className="wide">{text(language, "人设", "Persona")}<textarea rows={3} value={character.persona} onChange={(event) => onChange(character.id, { persona: event.target.value })} /></label>
                <label>{text(language, "说话风格", "Speaking style")}<textarea rows={3} value={character.speakingStyle} onChange={(event) => onChange(character.id, { speakingStyle: event.target.value })} /></label>
                <label>{text(language, "私人目标", "Private goal")}<textarea rows={3} value={character.privateGoal} onChange={(event) => onChange(character.id, { privateGoal: event.target.value })} /></label>
                <label>{text(language, "动机", "Motivation")}<textarea rows={3} value={character.motivation} onChange={(event) => onChange(character.id, { motivation: event.target.value })} /></label>
                <label>{text(language, "秘密", "Secrets")}<textarea rows={3} value={character.secrets} onChange={(event) => onChange(character.id, { secrets: event.target.value })} /></label>
                <label className="wide">{text(language, "初始记忆", "Initial memory")}<textarea rows={3} value={character.initialMemory} onChange={(event) => onChange(character.id, { initialMemory: event.target.value })} /></label>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SceneSettings({
  settings,
  language,
  onAdd,
  onChange,
  onRemove,
  onActiveChange,
}: {
  settings: AiProjectSettings;
  language: "zh" | "en";
  onAdd: () => void;
  onChange: (id: string, patch: Partial<AiScene>) => void;
  onRemove: (id: string) => void;
  onActiveChange: (id: string) => void;
}) {
  const names = useMemo(() => new Map(settings.characters.map((character) => [character.id, character.name || character.id])), [settings.characters]);
  return (
    <section className="ai-settings-section">
      <div className="ai-section-heading">
        <div><h3>{text(language, "场景", "Scenes")}</h3><p>{text(language, "这里配置角色的初始位置；生成时角色可移动，上帝也可切换场景视角。", "Configure initial character locations here; characters may move and the director may switch viewpoints during generation.")}</p></div>
        <button type="button" onClick={onAdd}><Plus size={16} aria-hidden="true" />{text(language, "添加场景", "Add Scene")}</button>
      </div>
      {settings.scenes.length > 0 && <label className="ai-active-scene">{text(language, "默认活动场景", "Default active scene")}<select value={settings.activeSceneId} onChange={(event) => onActiveChange(event.target.value)}>{settings.scenes.map((scene) => <option value={scene.id} key={scene.id}>{scene.name || scene.id}</option>)}</select></label>}
      {settings.scenes.length === 0 ? <EmptyState text={text(language, "还没有场景。场景用于控制哪些角色可以互相观察。", "No scenes yet. Scenes control which characters can observe each other.")} /> : (
        <div className="ai-card-list">
          {settings.scenes.map((scene, index) => (
            <article className="ai-config-card" key={scene.id}>
              <div className="ai-card-title"><strong>{scene.name || text(language, `场景 ${index + 1}`, `Scene ${index + 1}`)}</strong><code>{scene.id}</code><button type="button" className="icon-button danger" title={text(language, "删除场景", "Delete scene")} onClick={() => onRemove(scene.id)}><Trash2 size={15} aria-hidden="true" /></button></div>
              <div className="ai-form-grid compact">
                <label>{text(language, "场景名", "Name")}<input value={scene.name} onChange={(event) => onChange(scene.id, { name: event.target.value })} /></label>
                <label>{text(language, "背景图字段", "Background field")}<input value={scene.background} onChange={(event) => onChange(scene.id, { background: event.target.value })} /></label>
                <label className="wide">{text(language, "环境描述", "Description")}<textarea rows={3} value={scene.description} onChange={(event) => onChange(scene.id, { description: event.target.value })} /></label>
                <label className="wide">{text(language, "开场状态", "Opening state")}<textarea rows={3} value={scene.opening} onChange={(event) => onChange(scene.id, { opening: event.target.value })} /></label>
              </div>
              <fieldset className="ai-participants"><legend>{text(language, "初始在场角色", "Initial participants")}</legend>{settings.characters.length === 0 ? <span>{text(language, "请先添加角色", "Add characters first")}</span> : settings.characters.map((character) => <label key={character.id}><input type="checkbox" checked={scene.participantIds.includes(character.id)} onChange={(event) => onChange(scene.id, { participantIds: event.target.checked ? [...scene.participantIds, character.id] : scene.participantIds.filter((id) => id !== character.id) })} />{names.get(character.id)}</label>)}</fieldset>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SettingsTab({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof Bot; label: string; onClick: () => void }) {
  return <button type="button" className={active ? "active" : ""} onClick={onClick}><Icon size={16} aria-hidden="true" />{label}</button>;
}

function EmptyState({ text: value }: { text: string }) {
  return <div className="ai-empty-state">{value}</div>;
}

function createCharacter(existing: AiCharacter[]): AiCharacter {
  return {
    id: nextId("character", existing.map((item) => item.id)),
    name: "",
    roleId: "",
    model: "",
    position: existing.length % 2 === 0 ? "l" : "r",
    persona: "",
    speakingStyle: "",
    privateGoal: "",
    motivation: "",
    secrets: "",
    initialMemory: "",
  };
}

function createScene(existing: AiScene[]): AiScene {
  return {
    id: nextId("scene", existing.map((item) => item.id)),
    name: "",
    background: "",
    description: "",
    opening: "",
    participantIds: [],
  };
}

function nextId(prefix: string, existing: string[]): string {
  let index = existing.length + 1;
  while (existing.includes(`${prefix}-${index}`)) {
    index += 1;
  }
  return `${prefix}-${index}`;
}

function text(language: "zh" | "en", zh: string, en: string): string {
  return language === "en" ? en : zh;
}
