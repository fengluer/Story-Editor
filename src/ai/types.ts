export type AiProviderProtocol = "openai-responses" | "openai-chat";

export type AiModelSettings = {
  id: string;
  name: string;
};

export type AiProviderSettings = {
  id: string;
  name: string;
  protocol: AiProviderProtocol;
  baseURL: string;
  requiresApiKey: boolean;
  models: AiModelSettings[];
};

export type AiGodSettings = {
  name: string;
  model: string;
  prompt: string;
};

export type AiCharacter = {
  id: string;
  name: string;
  roleId: string;
  model: string;
  position: "l" | "r";
  persona: string;
  speakingStyle: string;
  privateGoal: string;
  motivation: string;
  secrets: string;
  initialMemory: string;
};

export type AiScene = {
  id: string;
  name: string;
  background: string;
  description: string;
  opening: string;
  participantIds: string[];
};

export type AiProjectSettings = {
  version: 2;
  providers: AiProviderSettings[];
  defaultModel: string;
  god: AiGodSettings;
  characters: AiCharacter[];
  scenes: AiScene[];
  activeSceneId: string;
};

export type AiPublicEvent = {
  id: string;
  sceneId: string;
  turn: number;
  actorId: string;
  kind: "speech" | "action" | "silence" | "observation" | "plot";
  speech: string;
  action: string;
  visibleTo: string[];
  destinationSceneId?: string;
};

export type AiCharacterState = {
  memory: string;
  emotion: string;
  nextIntent: string;
};

export type AiRuntimeState = {
  version: 2;
  sessionId: string;
  useFullStoryContext: boolean;
  events: AiPublicEvent[];
  characterStates: Record<string, AiCharacterState>;
  directorState: string;
  characterSceneIds: Record<string, string>;
  activeSceneId: string;
};

export type AiApiStatus = {
  available: boolean;
  configuredProviderIds: string[];
  message?: string;
};

export type AiModelRequest = {
  providerId: string;
  protocol: AiProviderProtocol;
  baseURL: string;
  requiresApiKey: boolean;
  model: string;
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
};

export type AiGodDecision = {
  sceneId: string;
  actorId: string;
  cue: "respond" | "observe" | "seek_information" | "raise_tension" | "deescalate" | "advance_private_goal";
  shouldConclude: boolean;
  conclusionReason: string;
  plotAdvance: string;
  observations: Array<{
    characterId: string;
    sight: string;
    hearing: string;
  }>;
  publicEvent: {
    description: string;
    visibleTo: string[];
  };
};

export type AiCharacterTurn = {
  behavior: "speak" | "act" | "remain_silent";
  speech: string;
  publicAction: string;
  emotion: string;
  privateIntent: string;
  memoryUpdate: string;
  destinationSceneId: string;
};

export type AiPreflightIssue = {
  severity: "error" | "warning";
  scope: "god_prompt" | "character" | "scene" | "instruction" | "project";
  targetId: string;
  message: string;
  suggestion: string;
};

export type AiPreflightResult = {
  valid: boolean;
  summary: string;
  issues: AiPreflightIssue[];
};

export type AiWriteOptions = {
  sceneId: string;
  instruction: string;
  turns: number;
};

export type AiWritingSession = {
  id: number;
  sourceName: string;
  options: AiWriteOptions;
  status: "validating" | "running" | "completed" | "stopped" | "validation_failed" | "failed";
  progress: string;
  error: string;
  validation: AiPreflightResult | null;
  contextNotice: string;
  completedTurns: number;
  referenceTurns: number;
  insertedCount: number;
  silentCount: number;
  rows: import("../types").StoryRow[];
  previewRowIds: string[];
  selectedRow: number;
  runtime: AiRuntimeState;
};
