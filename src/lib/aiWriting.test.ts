import { describe, expect, it } from "vitest";
import { defaultTemplate } from "../defaultTemplate";
import type { AiCharacter, AiProjectSettings, AiRuntimeState, AiScene } from "../ai/types";
import {
  AI_PREFLIGHT_SCHEMA,
  applyCharacterTurn,
  applyGodDecision,
  buildAiContextWindow,
  buildCharacterInput,
  buildCharacterInstructions,
  buildCharacterTurnSchema,
  buildGodInput,
  buildGodInstructions,
  buildGodDecisionSchema,
  buildPreflightInput,
  buildPreflightInstructions,
  storyExcerptBefore,
  validateCharacterTurn,
  validatePreflightResult,
  visibleEventsForCharacter,
} from "./aiWriting";

const detective: AiCharacter = {
  id: "detective",
  name: "侦探",
  roleId: "role_detective",
  model: "",
  reasoningEffort: "",
  position: "l",
  persona: "冷静谨慎",
  speakingStyle: "句子简短",
  privateGoal: "找到凶手",
  motivation: "保护证人",
  secrets: "自己丢失了关键证物",
  initialMemory: "今晚来到旅馆",
};

const butler: AiCharacter = {
  ...detective,
  id: "butler",
  name: "管家",
  roleId: "role_butler",
  secrets: "昨晚看见了真正的凶手",
};

const scene: AiScene = {
  id: "hotel-night",
  name: "旅馆大厅",
  background: "bg_hotel_night",
  description: "暴雨封住了出口",
  opening: "两人隔着柜台对视",
  participantIds: [detective.id, butler.id],
};

const kitchen: AiScene = {
  id: "kitchen",
  name: "厨房",
  background: "bg_kitchen",
  description: "炉火已经熄灭",
  opening: "厨房里没有人",
  participantIds: [],
};

const settings: AiProjectSettings = {
  version: 2,
  providers: [{ id: "openai", name: "OpenAI", protocol: "openai-responses", baseURL: "https://api.openai.com/v1", requiresApiKey: true, supportsReasoningEffort: true, models: [{ id: "gpt-test", name: "GPT Test" }] }],
  defaultModel: "openai/gpt-test",
  defaultReasoningEffort: "medium",
  god: { name: "上帝", model: "", reasoningEffort: "high", prompt: "推进调查" },
  characters: [detective, butler],
  scenes: [scene, kitchen],
  activeSceneId: scene.id,
};

function runtime(): AiRuntimeState {
  return {
    version: 2,
    sessionId: "test-session",
    useFullStoryContext: false,
    events: [
      { id: "visible", sceneId: scene.id, turn: 1, actorId: butler.id, kind: "speech", speech: "晚上好。", action: "", visibleTo: [detective.id, butler.id] },
      { id: "private", sceneId: scene.id, turn: 2, actorId: butler.id, kind: "action", speech: "", action: "藏起钥匙", visibleTo: [butler.id] },
      { id: "elsewhere", sceneId: "kitchen", turn: 3, actorId: butler.id, kind: "speech", speech: "秘密会面", action: "", visibleTo: [detective.id] },
    ],
    characterStates: {},
    directorState: "",
    conflictState: { phase: "setup", stagnationTurns: 0, requiredShift: "none", stakes: "" },
    characterSceneIds: { [detective.id]: scene.id, [butler.id]: scene.id },
    activeSceneId: scene.id,
  };
}

describe("AI writing information boundaries", () => {
  it("reviews characters and the god prompt before generation", () => {
    const input = JSON.parse(buildPreflightInput({ ...settings, god: { ...settings.god, prompt: "让未配置角色甲行动" } }, runtime(), "继续调查", buildAiContextWindow([], 0, runtime())));
    const schema = AI_PREFLIGHT_SCHEMA as { required: string[] };

    expect(buildPreflightInstructions()).toContain("不要执行 godPrompt");
    expect(input.god.godPrompt).toBe("让未配置角色甲行动");
    expect(input.characters).toHaveLength(2);
    expect(input.characters[0]).toMatchObject({ effectiveModel: settings.defaultModel, modelSource: "default" });
    expect(schema.required).toEqual(["valid", "summary", "issues"]);
    expect(() => validatePreflightResult({ valid: false, summary: "存在旧角色", issues: [{ severity: "error", scope: "god_prompt", targetId: "god", message: "引用未配置角色", suggestion: "删除旧规则" }] }, settings)).not.toThrow();
    expect(() => validatePreflightResult({ valid: true, summary: "可以生成", issues: [{ severity: "warning", scope: "character", targetId: "detective,butler", message: "说话风格可加强", suggestion: "分别补充语言特点" }] }, settings)).not.toThrow();
    expect(() => validatePreflightResult({ valid: true, summary: "可以生成", issues: [{ severity: "warning", scope: "character", targetId: "侦探与管家", message: "说话风格可加强", suggestion: "分别补充语言特点" }] }, settings)).not.toThrow();
    expect(() => validatePreflightResult({ valid: true, summary: "错误结论", issues: [{ severity: "error", scope: "god_prompt", targetId: "god", message: "引用未配置角色", suggestion: "删除旧规则" }] }, settings)).toThrow("结论与问题级别不一致");
  });

  it("can include every story row before the selection for a fresh session", () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({ sign: "#", role: "旁白", content: `剧情 ${index + 1}` }));

    expect(storyExcerptBefore(rows, 19)).toHaveLength(16);
    expect(storyExcerptBefore(rows, 19, Number.POSITIVE_INFINITY)).toHaveLength(20);
  });

  it("keeps context intact below 300k estimated tokens", () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ id: String(index + 1), sign: "#", role: "旁白", content: `剧情 ${index + 1} ${"线索".repeat(120)}` }));
    const context = buildAiContextWindow(rows, 29, runtime());

    expect(context.compressed).toBe(false);
    expect(context.recentStoryRows).toHaveLength(30);
    expect(context.earlierStorySummary).toEqual([]);
    expect(context.tokenBudget).toBe(300000);
  });

  it("compresses story and event history only after the 300k token budget", () => {
    const rows = Array.from({ length: 1000 }, (_, index) => ({ id: String(index + 1), sign: "#", role: index % 2 ? "管家" : "侦探", content: `剧情 ${index + 1} ${"线索".repeat(220)}`, backPic: scene.background }));
    const longRuntime = {
      ...runtime(),
      events: Array.from({ length: 40 }, (_, index) => ({ id: `event-${index}`, sceneId: scene.id, turn: index + 1, actorId: detective.id, kind: "action" as const, speech: "", action: `行动 ${index + 1} ${"细节".repeat(200)}`, visibleTo: [detective.id] })),
    };
    const context = buildAiContextWindow(rows, 999, longRuntime);

    expect(context.compressed).toBe(true);
    expect(context.estimatedTokens).toBeGreaterThan(280000);
    expect(context.originalStoryRows).toBe(1000);
    expect(context.recentStoryRows).toHaveLength(8);
    expect(context.recentStoryRows[0].id).toBe("993");
    expect(context.earlierStorySummary.length).toBeLessThanOrEqual(40);
    expect(context.globalFacts).toHaveLength(16);
    expect(context.globalFacts[0].id).toBe("event-24");
    expect(context.globalFacts.every((event) => event.action.length <= 240)).toBe(true);
  });

  it("gives the director scene metadata for conservative knowledge reconstruction", () => {
    const contextRows = [{
      id: "9",
      sign: "#",
      role: detective.name,
      roleID: detective.roleId,
      content: "我去厨房看看。",
      backPic: scene.background,
    }];
    const input = JSON.parse(buildGodInput(settings, runtime(), scene, "继续调查", buildAiContextWindow(contextRows, 0, runtime())));

    expect(input.existingStoryExcerpt[0]).toMatchObject({
      roleId: detective.roleId,
      background: scene.background,
      inferredSceneIds: [scene.id],
    });
  });

  it("builds a character prompt without another character's private profile", () => {
    const instructions = buildCharacterInstructions(detective);
    const input = buildCharacterInput(settings, runtime(), scene, detective, {
      sceneId: scene.id,
      actorId: detective.id,
      cue: "seek_information",
      actorDirective: "换一种方式验证管家的说法",
      conflictPhase: "probe",
      stagnationTurns: 0,
      requiredShift: "information",
      stakes: "能否取得新线索",
      pressureDelta: 0,
      shouldConclude: false,
      conclusionReason: "",
      plotAdvance: butler.secrets,
      observations: [],
      publicEvent: { description: "", visibleTo: [] },
    });

    expect(instructions).toContain(detective.secrets);
    expect(instructions).not.toContain(butler.secrets);
    expect(input).toContain("晚上好");
    expect(input).not.toContain("藏起钥匙");
    expect(input).toContain("秘密会面");
    expect(input).not.toContain(butler.secrets);
    expect(instructions).toContain("不得自行创造此前未建立的关键证据");
  });

  it("makes the director maintain prop continuity and avoid decorative events", () => {
    const instructions = buildGodInstructions(settings);

    expect(instructions).toContain("publicEvent 不是每轮必写的气氛旁白");
    expect(instructions).toContain("不要默认采用侦探审讯");
    expect(instructions).toContain("把剧情组织为短阶段");
    expect(instructions).toContain("第一次受阻可以明确坚持");
    expect(instructions).toContain("隐瞒者可以守住秘密");
    expect(instructions).toContain("维护世界事实、证据和物品的一致性");
    expect(instructions).toContain("不得让同一物品无过渡地改变位置或持有者");
  });

  it("keeps character performance genre-neutral and movement-consistent", () => {
    const instructions = buildCharacterInstructions(detective);

    expect(instructions).toContain("不要默认采用审讯笔录");
    expect(instructions).toContain(`第三人称角色名“${detective.name}”`);
    expect(instructions).toContain("destinationSceneId 必须与动作中的目标场景一致");
  });

  it("keeps assigned information available across scenes", () => {
    expect(visibleEventsForCharacter(runtime().events, scene.id, detective.id).map((event) => event.id)).toEqual(["visible", "elsewhere"]);
  });

  it("lets the director send remote message content without leaking the sender's action", () => {
    const remoteScene: AiScene = { ...scene, id: "remote", participantIds: [butler.id] };
    const observer: AiCharacter = { ...detective, id: "observer", name: "路人", secrets: "" };
    const activeScene: AiScene = { ...scene, participantIds: [detective.id, observer.id] };
    const directed = applyGodDecision(
      defaultTemplate,
      [],
      0,
      { ...runtime(), characterSceneIds: { [detective.id]: activeScene.id, [observer.id]: activeScene.id, [butler.id]: remoteScene.id } },
      { ...settings, characters: [detective, butler, observer], scenes: [activeScene, remoteScene] },
      activeScene,
      {
        sceneId: activeScene.id,
        actorId: detective.id,
        cue: "respond",
        actorDirective: "发送已经决定好的会面消息",
        conflictPhase: "probe",
        stagnationTurns: 0,
        requiredShift: "commitment",
        stakes: "秘密会面是否成立",
        pressureDelta: 0,
        shouldConclude: false,
        conclusionReason: "",
        plotAdvance: "A 正在秘密联系 B",
        observations: [{ characterId: butler.id, sight: "A 拿出手机发送消息", hearing: "今晚到钟楼见面" }],
        publicEvent: { description: "", visibleTo: [] },
      },
    );

    const butlerEvents = visibleEventsForCharacter(directed.runtime.events, remoteScene.id, butler.id);
    expect(butlerEvents.at(-1)).toMatchObject({ speech: "今晚到钟楼见面", action: "", visibleTo: [butler.id] });
    expect(visibleEventsForCharacter(directed.runtime.events, activeScene.id, observer.id)).toEqual([]);
    expect(directed.runtime.directorState).toContain("秘密联系");
  });
});

describe("AI character turns", () => {
  it("rejects contradictory behavior fields so the caller can request correction", () => {
    expect(() => validateCharacterTurn({
      behavior: "remain_silent",
      speech: "我还是要说。",
      publicAction: "",
      emotion: "犹豫",
      privateIntent: "试探",
      memoryUpdate: "",
      destinationSceneId: "",
      strategy: "respond",
      acceptedCost: "",
      stateChangeDimension: "none",
      stateChange: "",
    }, settings, runtime(), scene, detective)).toThrow("选择沉默时不能同时说出台词");
  });

  it("limits structured outputs to configured scenes", () => {
    const godSchema = buildGodDecisionSchema(settings) as { properties: { sceneId: { enum: string[] }; shouldConclude: { type: string } }; required: string[] };
    const characterSchema = buildCharacterTurnSchema(settings, scene.id) as { properties: { destinationSceneId: { enum: string[] } } };

    expect(godSchema.properties.sceneId.enum).toEqual([scene.id, kitchen.id]);
    expect(godSchema.properties.shouldConclude.type).toBe("boolean");
    expect(godSchema.required).toContain("conclusionReason");
    expect(characterSchema.properties.destinationSceneId.enum).toEqual(["", kitchen.id]);
  });

  it("keeps the director schema compatible with providers that only support basic strict JSON Schema", () => {
    const serialized = JSON.stringify(buildGodDecisionSchema(settings, runtime()));

    expect(serialized).not.toContain('"allOf"');
    expect(serialized).not.toContain('"anyOf"');
    expect(serialized).not.toContain('"const"');
  });

  it("treats reference turns as pacing guidance and passes endings to the actor", () => {
    const godInput = JSON.parse(buildGodInput(settings, runtime(), scene, "完成调查", buildAiContextWindow([], 0, runtime()), { currentTurn: 6, referenceTurns: 4, maximumTurns: 6, phase: "final" }));
    const characterInput = JSON.parse(buildCharacterInput(settings, runtime(), scene, detective, {
      sceneId: scene.id,
      actorId: detective.id,
      cue: "respond",
      actorDirective: "完成本幕指控",
      conflictPhase: "aftermath",
      stagnationTurns: 0,
      requiredShift: "commitment",
      stakes: "案件结论",
      pressureDelta: 0,
      shouldConclude: true,
      conclusionReason: "侦探已确认关键证据并作出最终指控",
      plotAdvance: "案件在本轮收束",
      observations: [],
      publicEvent: { description: "", visibleTo: [] },
    }));

    expect(godInput.pacing).toEqual({ currentTurn: 6, referenceTurns: 4, maximumTurns: 6, phase: "final" });
    expect(characterInput.storyConclusion).toEqual({ shouldConclude: true, reason: "侦探已确认关键证据并作出最终指控" });
    expect(buildGodInstructions(settings)).toContain("maximumTurns 是绝对最大收束轮数");
    expect(buildGodInstructions(settings)).toContain("不表示整部故事必须完结");
    expect(buildCharacterInstructions(detective)).toContain("不要求结束整部故事");
    expect(characterInput.actorDirective).toBe("完成本幕指控");
  });

  it("records silence without forcing an empty story row", () => {
    const result = applyCharacterTurn(defaultTemplate, [], 0, runtime(), settings, scene, detective, {
      behavior: "remain_silent",
      speech: "",
      publicAction: "",
      emotion: "警惕",
      privateIntent: "继续观察",
      memoryUpdate: "管家先开口了",
      destinationSceneId: "",
      strategy: "observe",
      acceptedCost: "",
      stateChangeDimension: "none",
      stateChange: "",
    });

    expect(result.inserted).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.runtime.events.at(-1)?.kind).toBe("silence");
    expect(result.runtime.events.at(-1)?.visibleTo).toEqual([detective.id, butler.id]);
    expect(result.runtime.characterStates.detective.nextIntent).toBe("继续观察");
    expect(result.runtime.conflictState.stagnationTurns).toBe(1);
  });

  it("writes a visible action and dialogue into a linked story node", () => {
    const result = applyCharacterTurn(defaultTemplate, [], 0, { version: 2, sessionId: "test-session", useFullStoryContext: false, events: [], characterStates: {}, directorState: "", conflictState: { phase: "probe", stagnationTurns: 0, requiredShift: "information", stakes: "查明真相" }, characterSceneIds: { [detective.id]: scene.id }, activeSceneId: scene.id }, settings, scene, detective, {
      behavior: "speak",
      speech: "昨晚你在哪里？",
      publicAction: "把照片放在柜台上",
      emotion: "克制",
      privateIntent: "观察管家的反应",
      memoryUpdate: "开始盘问管家",
      destinationSceneId: "",
      strategy: "question",
      acceptedCost: "暴露自己正在怀疑管家",
      stateChangeDimension: "information",
      stateChange: "管家必须回应具体的不在场问题",
    });

    expect(result.inserted).toBe(true);
    expect(result.rows[0]).toMatchObject({
      role: "侦探",
      roleID: "role_detective",
      boxPos: "l",
      backPic: "bg_hotel_night",
      content: "（把照片放在柜台上）昨晚你在哪里？",
    });
    expect(result.runtime.events[0].visibleTo).toEqual([detective.id]);
    expect(result.runtime.characterStates.detective.lastStrategy).toBe("question");
    expect(result.runtime.directorState).toContain("变化=information");
  });

  it("raises private pressure and rejects repeating the same stalled strategy", () => {
    const stalledRuntime = { ...runtime(), conflictState: { phase: "resistance" as const, stagnationTurns: 2, requiredShift: "information" as const, stakes: "嫌疑人可能离开" } };
    const pressured = applyGodDecision(defaultTemplate, [], 0, stalledRuntime, settings, scene, {
      sceneId: scene.id,
      actorId: detective.id,
      cue: "raise_tension",
      actorDirective: "停止重复追问，改用会改变局面的调查手段",
      conflictPhase: "escalation",
      stagnationTurns: 2,
      requiredShift: "information",
      stakes: "继续停滞会让嫌疑人离开",
      pressureDelta: 2,
      shouldConclude: false,
      conclusionReason: "",
      plotAdvance: "侦探必须换策略",
      observations: [],
      publicEvent: { description: "", visibleTo: [] },
    }).runtime;
    const repeatedRuntime = {
      ...pressured,
      characterStates: {
        ...pressured.characterStates,
        detective: { ...pressured.characterStates.detective, lastStrategy: "question" as const, strategyRepeatCount: 1 },
      },
    };

    expect(pressured.characterStates.detective.pressure).toBe(2);
    expect(() => validateCharacterTurn({
      behavior: "speak",
      speech: "你必须回答我。",
      publicAction: "",
      emotion: "急切",
      privateIntent: "继续逼问",
      memoryUpdate: "",
      destinationSceneId: "",
      strategy: "question",
      acceptedCost: "",
      stateChangeDimension: "none",
      stateChange: "",
    }, settings, repeatedRuntime, scene, detective)).toThrow("不能连续重复策略");
  });

  it("moves a character only to another configured scene", () => {
    const result = applyCharacterTurn(defaultTemplate, [], 0, runtime(), settings, scene, detective, {
      behavior: "act",
      speech: "",
      publicAction: "推开厨房门离开大厅",
      emotion: "警觉",
      privateIntent: "检查厨房",
      memoryUpdate: "决定调查厨房",
      destinationSceneId: kitchen.id,
      strategy: "investigate",
      acceptedCost: "离开当前对话",
      stateChangeDimension: "location",
      stateChange: "侦探离开大厅前往厨房",
    });

    expect(result.runtime.characterSceneIds.detective).toBe(kitchen.id);
    expect(result.runtime.events.at(-1)).toMatchObject({ sceneId: scene.id, destinationSceneId: kitchen.id });
    expect(() => applyCharacterTurn(defaultTemplate, [], 0, runtime(), settings, scene, detective, {
      behavior: "act",
      speech: "",
      publicAction: "离开",
      emotion: "",
      privateIntent: "",
      memoryUpdate: "",
      destinationSceneId: "missing",
      strategy: "withdraw",
      acceptedCost: "",
      stateChangeDimension: "location",
      stateChange: "试图离开当前场景",
    })).toThrow("无效的目标场景");
  });

  it("lets the director switch to a scene containing the selected actor", () => {
    const movedRuntime = { ...runtime(), characterSceneIds: { [detective.id]: kitchen.id, [butler.id]: scene.id } };
    const result = applyGodDecision(defaultTemplate, [], 0, movedRuntime, settings, kitchen, {
      sceneId: kitchen.id,
      actorId: detective.id,
      cue: "observe",
      actorDirective: "调查炉火旁的新动静",
      conflictPhase: "probe",
      stagnationTurns: 0,
      requiredShift: "information",
      stakes: "厨房中的线索",
      pressureDelta: 0,
      shouldConclude: false,
      conclusionReason: "",
      plotAdvance: "跟随侦探进入厨房",
      observations: [],
      publicEvent: { description: "炉火旁传来异响", visibleTo: [detective.id] },
    });

    expect(result.runtime.activeSceneId).toBe(kitchen.id);
    expect(result.rows[0].backPic).toBe(kitchen.background);
  });
});
