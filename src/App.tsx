import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  ClipboardPaste,
  Download,
  FileSpreadsheet,
  Gift,
  GitBranch,
  Languages,
  Octagon,
  MessageSquare,
  Network,
  Plus,
  Save,
  Search,
  Settings,
  Sparkles,
  Table2,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createEmptyRow, defaultTemplate } from "./defaultTemplate";
import { AiSettingsModal } from "./components/AiSettingsModal";
import { AiWritingModal } from "./components/AiWritingModal";
import { AiWritingProgressModal } from "./components/AiWritingProgressModal";
import type { AiApiStatus, AiCharacterTurn, AiGodDecision, AiModelRequest, AiPreflightResult, AiProjectSettings, AiWriteOptions, AiWritingSession } from "./ai/types";
import { createEmptyAiRuntime, loadAiRuntime, loadAiSettings, saveAiRuntime, saveAiSettings } from "./lib/aiStorage";
import { resolveAiModel, validateAiSettings } from "./lib/aiModels";
import {
  applyCharacterTurn,
  applyGodDecision,
  AI_PREFLIGHT_SCHEMA,
  buildAiContextWindow,
  buildPreflightInput,
  buildPreflightInstructions,
  buildCharacterInput,
  buildCharacterInstructions,
  buildGodInput,
  buildGodInstructions,
  buildCharacterTurnSchema,
  buildGodDecisionSchema,
  participantIdsForScene,
  validateCharacterTurn,
  validateGodDecisionForRuntime,
  validatePreflightResult,
} from "./lib/aiWriting";
import { filenameWithExt, saveBlob } from "./lib/download";
import { loadDraft, saveDraft } from "./lib/draftStorage";
import { readFileAsArrayBuffer, readFileAsText } from "./lib/fileReaders";
import { applyReplacement, defaultReplaceColumns, previewReplacement } from "./lib/replace";
import { deleteStoryNode, ensureFirstBeginFlag, getEditorColumns, insertStoryNode, nodeTypeLabel, type StoryEditorLanguage } from "./lib/rowActions";
import { insertScriptRowsFromClipboard } from "./lib/scriptPreprocess";
import {
  exportCsvText,
  importCsvText,
  normalizeRows,
  removeColumnFromRows,
  updateColumnKey,
  validateContentLength,
  validateContentNewlines,
  validateRightSideRolePosition,
  validateStory,
} from "./lib/storyTable";
import { loadSavedTemplate, saveTemplate } from "./lib/templateStorage";
import { shouldBlockTextareaNewline, stripPastedNewlines } from "./lib/textInput";
import { exportWorkbookBuffer, importWorkbookBuffer } from "./lib/workbook";
import type { ColumnTemplate, ReplaceOptions, StoryRow, StoryTemplate } from "./types";

type StoryNodeKind = "dialogue" | "reward" | "choice" | "end";
type ViewMode = "table" | "nodes";
type AppLanguage = StoryEditorLanguage;

const AUTO_SAVE_INTERVAL_MS = 3 * 60 * 1000;
const DEFAULT_CHARACTER_LIMIT = 40;
const CHARACTER_LIMIT_STORAGE_KEY = "story-editor-character-limit";
const NEWLINE_VALIDATION_STORAGE_KEY = "story-editor-newline-validation";
const LANGUAGE_STORAGE_KEY = "story-editor-language";
const RIGHT_SIDE_ROLE_STORAGE_KEY = "story-editor-right-side-role-keyword";
const NODE_POSITION_STORAGE_PREFIX = "story-editor.node-positions";
const GRAPH_NODE_WIDTH = 320;
const GRAPH_NODE_HEIGHT = 260;
const GRAPH_COLUMN_GAP = 96;
const GRAPH_ROW_GAP = 56;
const GRAPH_PADDING = 36;

type GraphLinkKind = "skip";
type GraphEdgeKind = "skip" | "choice";

type ChoiceItem = {
  option: StoryRow;
  optionIndex: number;
  dialogue?: StoryRow;
  dialogueIndex: number;
};

type ChoiceContext = {
  parentIndex: number;
  parent: StoryRow;
  choices: ChoiceItem[];
};

type NodePosition = {
  x: number;
  y: number;
};

type GraphEdge = {
  kind: GraphEdgeKind;
  sourceIndex: number;
  targetIndex: number;
  label: string;
};

type ConnectionDrag = {
  sourceIndex: number;
  kind: GraphLinkKind;
  pointer: NodePosition;
};

type PaletteDrag = {
  kind: StoryNodeKind;
  pointer: NodePosition;
};

type ConfirmDialog = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmFirst?: boolean;
  intent?: "danger";
  onConfirm: () => void;
};

type CanvasPanDrag = {
  startClientX: number;
  startClientY: number;
  scrollLeft: number;
  scrollTop: number;
};

function initialTemplate(): StoryTemplate {
  return loadDraft()?.template ?? loadSavedTemplate() ?? defaultTemplate;
}

function initialRows(): StoryRow[] {
  return ensureFirstBeginFlag(loadDraft()?.rows ?? []);
}

function initialSourceName(): string {
  return loadDraft()?.sourceName ?? "story.csv";
}

function initialLanguage(): AppLanguage {
  return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === "en" ? "en" : "zh";
}

function initialSelectedRow(): number {
  return loadDraft()?.selectedRow ?? 0;
}

function initialStatus(language: AppLanguage): string {
  const draft = loadDraft();
  return draft
    ? tr(language, `已恢复上次草稿，保存于 ${formatSavedAt(draft.savedAt)}`, `Restored last draft, saved at ${formatSavedAt(draft.savedAt)}`)
    : tr(language, "默认模板已就绪", "Default template is ready");
}

function initialCharacterLimit(): number | null {
  const raw = window.localStorage.getItem(CHARACTER_LIMIT_STORAGE_KEY);
  if (raw === "") {
    return null;
  }

  const saved = Number(raw);
  return Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_CHARACTER_LIMIT;
}

function initialNewlineValidationEnabled(): boolean {
  return window.localStorage.getItem(NEWLINE_VALIDATION_STORAGE_KEY) === "true";
}

function initialRightSideRoleKeyword(): string {
  return window.localStorage.getItem(RIGHT_SIDE_ROLE_STORAGE_KEY) ?? "";
}

function initialNodePositions(): Record<string, NodePosition> {
  return loadNodePositions(initialSourceName());
}

export function App() {
  const [template, setTemplate] = useState<StoryTemplate>(() => initialTemplate());
  const [rows, setRows] = useState<StoryRow[]>(() => initialRows());
  const [selectedRow, setSelectedRow] = useState(() => initialSelectedRow());
  const [sourceName, setSourceName] = useState(() => initialSourceName());
  const [language, setLanguage] = useState<AppLanguage>(() => initialLanguage());
  const [status, setStatus] = useState(() => initialStatus(initialLanguage()));
  const [toast, setToast] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(() => loadDraft()?.savedAt ?? null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [undoRows, setUndoRows] = useState<StoryRow[] | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [characterLimit, setCharacterLimit] = useState(() => initialCharacterLimit());
  const [newlineValidationEnabled, setNewlineValidationEnabled] = useState(() => initialNewlineValidationEnabled());
  const [rightSideRoleKeyword, setRightSideRoleKeyword] = useState(() => initialRightSideRoleKeyword());
  const [nodePositions, setNodePositions] = useState<Record<string, NodePosition>>(() => initialNodePositions());
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [aiSettings, setAiSettings] = useState<AiProjectSettings>(() => loadAiSettings(initialSourceName()));
  const [aiRuntime, setAiRuntime] = useState(() => {
    const settings = loadAiSettings(initialSourceName());
    return loadAiRuntime(initialSourceName(), settings);
  });
  const [aiApiStatus, setAiApiStatus] = useState<AiApiStatus>({ available: Boolean(window.storyEditorAi), configuredProviderIds: [] });
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiWritingOpen, setAiWritingOpen] = useState(false);
  const [aiWritingSession, setAiWritingSession] = useState<AiWritingSession | null>(null);
  const [replaceOptions, setReplaceOptions] = useState<ReplaceOptions>(() => ({
    find: "",
    replace: "",
    columns: defaultReplaceColumns(initialTemplate()),
    useRegex: false,
    matchCase: false,
  }));
  const appRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());
  const nodeRefs = useRef(new Map<number, HTMLElement>());
  const pendingScrollRowRef = useRef<number | null>(null);
  const pendingEditorFocusRowRef = useRef<number | null>(null);
  const aiWritingRunIdRef = useRef(0);

  const structureIssues = useMemo(() => validateStory(template, rows, language), [language, template, rows]);
  const characterIssues = useMemo(() => validateContentLength(rows, characterLimit, language), [language, rows, characterLimit]);
  const newlineIssues = useMemo(() => validateContentNewlines(rows, newlineValidationEnabled, language), [language, newlineValidationEnabled, rows]);
  const rightSideRoleIssues = useMemo(() => validateRightSideRolePosition(rows, rightSideRoleKeyword, language), [language, rightSideRoleKeyword, rows]);
  const issues = useMemo(
    () => [...structureIssues, ...characterIssues, ...newlineIssues, ...rightSideRoleIssues],
    [characterIssues, newlineIssues, rightSideRoleIssues, structureIssues],
  );
  const lengthWarningRows = useMemo(() => new Set([...characterIssues, ...newlineIssues].map((issue) => issue.rowIndex)), [characterIssues, newlineIssues]);
  const positionWarningRows = useMemo(() => new Set(rightSideRoleIssues.map((issue) => issue.rowIndex)), [rightSideRoleIssues]);
  const editorColumns = useMemo(() => getEditorColumns(template, rows), [template, rows]);
  const dialogueConfigColumns = useMemo(() => getDialogueConfigColumns(template), [template]);
  const selected = rows[selectedRow] ?? createEmptyRow(template);
  const choiceContext = useMemo(() => getChoiceContext(rows, selectedRow), [rows, selectedRow]);
  const graphEdges = useMemo(() => buildGraphEdges(rows), [rows]);
  const draftSnapshot = useMemo(() => makeDraftSnapshot({ sourceName, template, rows, selectedRow }), [rows, selectedRow, sourceName, template]);
  const lastSavedSnapshotRef = useRef(draftSnapshot);
  const replacePreview = useMemo(() => {
    try {
      return previewReplacement(rows, replaceOptions);
    } catch {
      return { matches: 0, affectedCells: 0 };
    }
  }, [replaceOptions, rows]);

  useEffect(() => {
    setHasUnsavedChanges(draftSnapshot !== lastSavedSnapshotRef.current);
  }, [draftSnapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!hasUnsavedChanges) {
        return;
      }
      persistDraft("auto");
    }, AUTO_SAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasUnsavedChanges, rows, selectedRow, sourceName, template]);

  useEffect(() => {
    window.localStorage.setItem(CHARACTER_LIMIT_STORAGE_KEY, characterLimit === null ? "" : String(characterLimit));
  }, [characterLimit]);

  useEffect(() => {
    window.localStorage.setItem(NEWLINE_VALIDATION_STORAGE_KEY, newlineValidationEnabled ? "true" : "false");
  }, [newlineValidationEnabled]);

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    window.localStorage.setItem(RIGHT_SIDE_ROLE_STORAGE_KEY, rightSideRoleKeyword);
  }, [rightSideRoleKeyword]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setNodePositions(loadNodePositions(sourceName));
  }, [sourceName]);

  useEffect(() => {
    const nextSettings = loadAiSettings(sourceName);
    setAiSettings(nextSettings);
    setAiRuntime(loadAiRuntime(sourceName, nextSettings));
  }, [sourceName]);

  useEffect(() => {
    void refreshAiApiStatus();
  }, []);

  useEffect(() => {
    setNodePositions((current) => reconcileNodePositions(rows, current));
  }, [rows]);

  useEffect(() => {
    saveNodePositions(sourceName, nodePositions);
  }, [nodePositions, sourceName]);

  useEffect(() => {
    const rowIndex = pendingScrollRowRef.current;
    if (rowIndex === null) {
      return;
    }

    pendingScrollRowRef.current = null;
    window.requestAnimationFrame(() => {
      const target = viewMode === "nodes" ? nodeRefs.current.get(rowIndex) : rowRefs.current.get(rowIndex);
      target?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      if (pendingEditorFocusRowRef.current === rowIndex) {
        pendingEditorFocusRowRef.current = null;
        focusEditableElement(target);
      }
    });
  }, [rows, selectedRow, viewMode]);

  function persistDraft(mode: "manual" | "auto") {
    const savedRows = ensureFirstBeginFlag(rows);
    const draft = saveDraft({ sourceName, template, rows: savedRows, selectedRow });
    lastSavedSnapshotRef.current = makeDraftSnapshot({ sourceName, template, rows: savedRows, selectedRow: draft.selectedRow });
    if (savedRows !== rows) {
      setRows(savedRows);
    }
    setLastSavedAt(draft.savedAt);
    setHasUnsavedChanges(false);
    const message =
      mode === "manual"
        ? tr(language, `进度已保存：${formatSavedAt(draft.savedAt)}`, `Progress saved: ${formatSavedAt(draft.savedAt)}`)
        : tr(language, `已自动保存：${formatSavedAt(draft.savedAt)}`, `Auto-saved: ${formatSavedAt(draft.savedAt)}`);
    if (mode === "manual") {
      notifySuccess(message);
    } else {
      setStatus(message);
    }
  }

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) {
      restoreAppFocus();
      return;
    }

    try {
      const extension = file.name.split(".").pop()?.toLowerCase();
      const parsed =
        extension === "xlsx" || extension === "xls"
          ? importWorkbookBuffer(await readFileAsArrayBuffer(file), file.name)
          : importCsvText(await readFileAsText(file), file.name);

      setTemplate(parsed.template);
      setRows(ensureFirstBeginFlag(normalizeRows(parsed.template, parsed.rows)));
      selectRow(0, true, true);
      setSourceName(file.name);
      setReplaceOptions((current) => ({ ...current, columns: defaultReplaceColumns(parsed.template) }));
      setStatus(
        tr(
          language,
          `已导入 ${parsed.rows.length} 个节点，${parsed.template.columns.length} 个导出字段`,
          `Imported ${parsed.rows.length} nodes and ${parsed.template.columns.length} export columns`,
        ),
      );
      setHasUnsavedChanges(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : tr(language, "导入失败", "Import failed"));
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      restoreAppFocus({ focusSelectedEditor: true });
    }
  }

  async function preprocessScriptFromClipboard() {
    try {
      const clipboardText = await readClipboardText();
      if (!clipboardText?.trim()) {
        setStatus(tr(language, "剪贴板为空：请先从 Excel 复制场景、角色名、正文三列", "Clipboard is empty. Copy scene, role, and content columns from Excel first."));
        return;
      }

      const result = insertScriptRowsFromClipboard(template, rows, selectedRow, clipboardText);
      if (result.insertedCount === 0) {
        setStatus(tr(language, "剪贴板没有可写入的正文行", "Clipboard has no content rows to insert"));
        return;
      }

      setRows(result.rows);
      selectRow(result.insertedIndex, true, true);
      setHasUnsavedChanges(true);
      setStatus(
        tr(
          language,
          `已预处理 ${result.insertedCount} 行剧本，旁白角色留空 ${result.narratorCount} 行`,
          `Preprocessed ${result.insertedCount} script rows; narrator roles left empty in ${result.narratorCount} rows`,
        ),
      );
    } catch (error) {
      setStatus(error instanceof Error ? tr(language, `读取剪贴板失败：${error.message}`, `Failed to read clipboard: ${error.message}`) : tr(language, "读取剪贴板失败", "Failed to read clipboard"));
    } finally {
      restoreAppFocus({ focusSelectedEditor: true });
    }
  }

  function updateCell(rowIndex: number, key: string, value: string) {
    setRows((current) => current.map((row, index) => (index === rowIndex ? { ...row, [key]: value } : row)));
  }

  function selectRow(rowIndex: number, scrollIntoView = false, focusEditor = false) {
    if (scrollIntoView) {
      pendingScrollRowRef.current = rowIndex;
    }
    if (focusEditor) {
      pendingEditorFocusRowRef.current = rowIndex;
    }
    setSelectedRow(rowIndex);
  }

  function notifySuccess(message: string) {
    setStatus(message);
    setToast(message);
  }

  async function refreshAiApiStatus(): Promise<AiApiStatus> {
    if (!window.storyEditorAi) {
      const next = {
        available: false,
        configuredProviderIds: [],
        message: tr(language, "AI 调用只在 Electron 桌面版中可用", "AI calls are available only in the Electron desktop app"),
      };
      setAiApiStatus(next);
      return next;
    }
    try {
      const next = await window.storyEditorAi.getStatus();
      setAiApiStatus(next);
      return next;
    } catch (error) {
      const next = { available: false, configuredProviderIds: [], message: error instanceof Error ? error.message : tr(language, "无法读取 AI 状态", "Unable to read AI status") };
      setAiApiStatus(next);
      return next;
    }
  }

  async function persistAiConfiguration(next: AiProjectSettings, apiKeys: Record<string, string>) {
    validateAiSettings(next);
    const keysToSave = Object.entries(apiKeys).filter(([, apiKey]) => apiKey.trim());
    if (keysToSave.length > 0) {
      if (!window.storyEditorAi) {
        throw new Error(tr(language, "请在 Electron 桌面版中保存 API Key", "Save the API key in the Electron desktop app"));
      }
      for (const [providerId, apiKey] of keysToSave) {
        await window.storyEditorAi.saveApiKey(providerId, apiKey);
      }
    }
    saveAiSettings(sourceName, next);
    setAiSettings(next);
    const nextRuntime = loadAiRuntime(sourceName, next);
    setAiRuntime(nextRuntime);
    saveAiRuntime(sourceName, nextRuntime);
    await refreshAiApiStatus();
    notifySuccess(tr(language, "AI 设定已保存", "AI settings saved"));
  }

  async function openAiWriter() {
    if (aiSettings.characters.length === 0 || aiSettings.scenes.length === 0) {
      setStatus(tr(language, "请先添加至少一个角色和一个场景", "Add at least one character and one scene first"));
      setAiSettingsOpen(true);
      return;
    }
    try {
      validateAiSettings(aiSettings);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : tr(language, "AI 模型配置无效", "The AI model configuration is invalid"));
      setAiSettingsOpen(true);
      return;
    }
    const status = await refreshAiApiStatus();
    const selectedModels = [
      resolveAiModel(aiSettings, aiSettings.god.model),
      ...aiSettings.characters.map((character) => resolveAiModel(aiSettings, character.model)),
    ];
    const missingProvider = selectedModels.find(({ provider }) => provider.requiresApiKey && !status.configuredProviderIds.includes(provider.id));
    if (!status.available || missingProvider) {
      setStatus(status.message || tr(language, `请先配置 ${missingProvider?.provider.name ?? "AI"} 的 API Key`, `Configure the API key for ${missingProvider?.provider.name ?? "AI"} first`));
      setAiSettingsOpen(true);
      return;
    }
    setAiWritingOpen(true);
  }

  async function generateAiStory(options: AiWriteOptions, resumedSession?: AiWritingSession) {
    if (!window.storyEditorAi) {
      throw new Error(tr(language, "请使用 Electron 桌面版运行 AI 编写", "Run AI writing from the Electron desktop app"));
    }
    const startingScene = aiSettings.scenes.find((candidate) => candidate.id === options.sceneId);
    if (!startingScene) {
      throw new Error(tr(language, "没有找到所选场景", "The selected scene was not found"));
    }
    const baseRuntime = resumedSession?.runtime ?? aiRuntime;
    const participants = participantIdsForScene(baseRuntime, resumedSession?.runtime.activeSceneId || startingScene.id)
      .map((id) => aiSettings.characters.find((character) => character.id === id))
      .filter((character) => Boolean(character));
    if (participants.length === 0) {
      throw new Error(tr(language, "当前场景没有有效的在场角色", "The scene has no valid participants"));
    }

    const runId = aiWritingRunIdRef.current + 1;
    aiWritingRunIdRef.current = runId;
    setAiWritingOpen(false);
    let workingRows = resumedSession?.rows ?? rows;
    let workingSelectedRow = resumedSession?.selectedRow ?? selectedRow;
    let workingRuntime = resumedSession?.runtime ?? { ...aiRuntime, activeSceneId: startingScene.id };
    let insertedCount = resumedSession?.insertedCount ?? 0;
    let silentCount = resumedSession?.silentCount ?? 0;
    const previewRowIds: string[] = [...(resumedSession?.previewRowIds ?? [])];
    setAiWritingSession({
      id: runId,
      sourceName,
      options,
      status: resumedSession?.validation?.valid ? "running" : "validating",
      progress: resumedSession?.validation?.valid
        ? tr(language, `正在从第 ${resumedSession.completedTurns + 1} 轮继续生成…`, `Resuming from turn ${resumedSession.completedTurns + 1}…`)
        : tr(language, "上帝正在校验角色、场景和导演规则的合理性…", "The director is validating characters, scenes, and director rules…"),
      error: "",
      validation: resumedSession?.validation ?? null,
      contextNotice: resumedSession?.contextNotice ?? "",
      completedTurns: resumedSession?.completedTurns ?? 0,
      referenceTurns: options.turns,
      insertedCount: 0,
      silentCount: 0,
      rows: workingRows,
      previewRowIds: [...previewRowIds],
      selectedRow: workingSelectedRow,
      runtime: workingRuntime,
    });
    const publish = (patch: Partial<AiWritingSession>) => {
      if (aiWritingRunIdRef.current !== runId) return;
      setAiWritingSession((current) => current?.id === runId ? { ...current, ...patch } : current);
    };
    try {
      const godModel = resolveAiModel(aiSettings, aiSettings.god.model);
      if (!resumedSession?.validation?.valid) {
        const preflightContext = buildAiContextWindow(workingRows, workingSelectedRow, workingRuntime);
        if (preflightContext.compressed) {
        publish({ contextNotice: tr(language, `上下文已压缩：${preflightContext.originalStoryRows} 条剧情保留最近 8 条原文，其余转为提要；事件保留最近 ${Math.min(preflightContext.originalEvents, 16)} 条。`, `Context compressed: ${preflightContext.originalStoryRows} story rows keep the latest 8 in full and summarize earlier rows; ${Math.min(preflightContext.originalEvents, 16)} recent events retained.`) });
        }
        const preflight = await callAiModelWithCorrection<AiPreflightResult>({
          providerId: godModel.provider.id,
          protocol: godModel.provider.protocol,
          baseURL: godModel.provider.baseURL,
          requiresApiKey: godModel.provider.requiresApiKey,
          model: godModel.model.id,
          instructions: buildPreflightInstructions(),
          input: buildPreflightInput(aiSettings, workingRuntime, options.instruction, preflightContext),
          schemaName: "story_preflight_validation",
          schema: AI_PREFLIGHT_SCHEMA,
        }, (result) => validatePreflightResult(result, aiSettings), runId, tr(language, "生成前校验", "preflight validation"));
        if (aiWritingRunIdRef.current !== runId) return;
        if (!preflight.valid) {
          publish({ status: "validation_failed", validation: preflight, progress: tr(language, "生成前校验未通过，请根据结果修改 AI 设定后重试。", "Preflight validation failed. Update the AI settings and try again.") });
          return;
        }
        publish({ status: "running", validation: preflight, progress: preflight.issues.length > 0 ? tr(language, "校验通过，但存在建议项；开始生成剧情…", "Validation passed with recommendations; starting generation…") : tr(language, "校验通过，开始生成剧情…", "Validation passed; starting generation…") });
      }
      const extraTurns = Math.max(2, Math.ceil(options.turns * 0.25));
      const maximumTurns = options.turns + extraTurns;
      for (let turnIndex = resumedSession?.completedTurns ?? 0; turnIndex < maximumTurns; turnIndex += 1) {
        const currentTurn = turnIndex + 1;
        const pacingPhase = currentTurn >= maximumTurns ? "final" : currentTurn >= options.turns ? "concluding" : "developing";
        const turnContext = buildAiContextWindow(workingRows, workingSelectedRow, workingRuntime);
        if (turnContext.compressed) {
          publish({ contextNotice: tr(language, `上下文已压缩：${turnContext.originalStoryRows} 条剧情保留最近 8 条原文，其余转为提要；事件保留最近 ${Math.min(turnContext.originalEvents, 16)} 条。`, `Context compressed: ${turnContext.originalStoryRows} story rows keep the latest 8 in full and summarize earlier rows; ${Math.min(turnContext.originalEvents, 16)} recent events retained.`) });
        }
        publish({ progress: tr(language, `第 ${currentTurn} 轮（参考 ${options.turns}，最多 ${maximumTurns}）：上帝正在${pacingPhase === "developing" ? "推进" : "收束"}剧情…`, `Turn ${currentTurn} (reference ${options.turns}, max ${maximumTurns}): the director is ${pacingPhase === "developing" ? "developing" : "concluding"} the story…`) });
        const decision = await callAiModelWithCorrection<AiGodDecision>({
          providerId: godModel.provider.id,
          protocol: godModel.provider.protocol,
          baseURL: godModel.provider.baseURL,
          requiresApiKey: godModel.provider.requiresApiKey,
          model: godModel.model.id,
          instructions: buildGodInstructions(aiSettings),
          input: buildGodInput(aiSettings, workingRuntime, aiSettings.scenes.find((candidate) => candidate.id === workingRuntime.activeSceneId) ?? startingScene, options.instruction, turnContext, { currentTurn, referenceTurns: options.turns, maximumTurns, phase: pacingPhase }),
          schemaName: "story_director_decision",
          schema: buildGodDecisionSchema(aiSettings, workingRuntime),
        }, (result) => {
          const resultScene = aiSettings.scenes.find((candidate) => candidate.id === result.sceneId);
          if (!resultScene) {
            throw new Error(`上帝 AI 选择了未知场景：${result.sceneId || "空"}`);
          }
          validateGodDecisionForRuntime(result, aiSettings, workingRuntime, resultScene);
          if (pacingPhase === "final" && !result.shouldConclude) {
            throw new Error(`已达到最大收束轮数 ${maximumTurns}，本轮必须形成本幕落点并返回 shouldConclude=true`);
          }
        }, runId, tr(language, "上帝导演决策", "director decision"));
        if (aiWritingRunIdRef.current !== runId) return;
        const turnScene = aiSettings.scenes.find((candidate) => candidate.id === decision.sceneId);
        if (!turnScene) throw new Error(tr(language, `上帝选择了未知场景：${decision.sceneId}`, `The director selected an unknown scene: ${decision.sceneId}`));
        const directed = applyGodDecision(template, workingRows, workingSelectedRow, workingRuntime, aiSettings, turnScene, decision);
        workingRows = directed.rows;
        workingSelectedRow = directed.selectedRow;
        workingRuntime = directed.runtime;
        if (directed.inserted) {
          insertedCount += 1;
          previewRowIds.push(workingRows[workingSelectedRow].id);
        }
        publish({ rows: workingRows, selectedRow: workingSelectedRow, runtime: workingRuntime, insertedCount, previewRowIds: [...previewRowIds] });
        const character = aiSettings.characters.find((candidate) => candidate.id === decision.actorId);
        if (!character) {
          throw new Error(tr(language, `没有找到角色：${decision.actorId}`, `Character not found: ${decision.actorId}`));
        }

        publish({ progress: tr(language, `第 ${turnIndex + 1} 轮：${character.name || character.id} 正在 ${turnScene.name || turnScene.id} ${decision.shouldConclude ? "完成本幕" : "行动"}…`, `Turn ${turnIndex + 1}: ${character.name || character.id} is ${decision.shouldConclude ? "closing the scene" : "acting"} in ${turnScene.name || turnScene.id}…`) });
        const characterModel = resolveAiModel(aiSettings, character.model);
        const characterTurn = await callAiModelWithCorrection<AiCharacterTurn>({
          providerId: characterModel.provider.id,
          protocol: characterModel.provider.protocol,
          baseURL: characterModel.provider.baseURL,
          requiresApiKey: characterModel.provider.requiresApiKey,
          model: characterModel.model.id,
          instructions: buildCharacterInstructions(character),
          input: buildCharacterInput(aiSettings, workingRuntime, turnScene, character, decision),
          schemaName: "story_character_turn",
          schema: buildCharacterTurnSchema(aiSettings, turnScene.id),
        }, (result) => validateCharacterTurn(result, aiSettings, workingRuntime, turnScene, character), runId, tr(language, `${character.name || character.id} 的角色行动`, `${character.name || character.id}'s character turn`));
        if (aiWritingRunIdRef.current !== runId) return;
        const applied = applyCharacterTurn(template, workingRows, workingSelectedRow, workingRuntime, aiSettings, turnScene, character, characterTurn);
        workingRows = applied.rows;
        workingSelectedRow = applied.selectedRow;
        workingRuntime = applied.runtime;
        if (applied.inserted) {
          insertedCount += 1;
          previewRowIds.push(workingRows[workingSelectedRow].id);
        } else {
          silentCount += 1;
        }
        publish({
          progress: decision.shouldConclude
            ? tr(language, `第 ${turnIndex + 1} 轮已形成本幕落点：${decision.conclusionReason}`, `The scene reached its closing beat on turn ${turnIndex + 1}: ${decision.conclusionReason}`)
            : tr(language, `已完成第 ${turnIndex + 1} 轮，本幕尚未结束`, `Completed turn ${turnIndex + 1}; the scene continues`),
          completedTurns: turnIndex + 1,
          rows: workingRows,
          selectedRow: workingSelectedRow,
          runtime: workingRuntime,
          insertedCount,
          silentCount,
          previewRowIds: [...previewRowIds],
        });
        if (decision.shouldConclude) {
          break;
        }
      }
      publish({ status: "completed", progress: tr(language, "本幕已形成明确落点，请确认是否写入编辑器。", "The scene has reached a clear closing beat. Confirm whether to write it to the editor.") });
    } catch (error) {
      publish({ status: "failed", error: error instanceof Error ? error.message : tr(language, "AI 编写失败", "AI writing failed") });
    }
  }

  function discardAiWritingResult() {
    aiWritingRunIdRef.current += 1;
    setAiWritingSession(null);
  }

  function stopAiWriting() {
    aiWritingRunIdRef.current += 1;
    setAiWritingSession((current) => current && (current.status === "running" || current.status === "validating") ? {
      ...current,
      status: "stopped",
      progress: current.previewRowIds.length > 0
        ? tr(language, "已停止继续生成，可以写入当前已生成内容或丢弃。", "Generation stopped. You can write the generated content or discard it.")
        : tr(language, "已停止生成，尚无可写入内容。", "Generation stopped with no content to write."),
    } : current);
  }

  function retryAiWriting() {
    const session = aiWritingSession;
    if (!session || !["failed", "stopped", "validation_failed"].includes(session.status)) return;
    void generateAiStory(session.options, session);
  }

  function confirmAiWritingResult() {
    const session = aiWritingSession;
    const canCommit = session && session.sourceName === sourceName && session.previewRowIds.length > 0 && ["completed", "stopped", "failed"].includes(session.status);
    if (!session || !canCommit) return;
    setRows(session.rows);
    setAiRuntime(session.runtime);
    saveAiRuntime(sourceName, session.runtime);
    setSelectedRow(session.selectedRow);
    pendingScrollRowRef.current = session.selectedRow;
    pendingEditorFocusRowRef.current = session.selectedRow;
    setAiWritingSession(null);
    notifySuccess(tr(language, `AI 已写入 ${session.insertedCount} 个${session.status === "completed" ? "" : "阶段性"}节点`, `AI wrote ${session.insertedCount} ${session.status === "completed" ? "" : "partial "}nodes`));
  }

  function requestClearAiMemory() {
    setConfirmDialog({
      title: tr(language, "清空 AI 记忆", "Clear AI memory"),
      message: tr(language, "将清空所有 AI 事件、角色私有记忆、位置和当前视角，并开启全新 Session。编辑器中的剧本节点不会删除；上帝仍会读取现有文本作为前情，并按角色应知范围转述给角色 AI。", "This clears all AI events, private character memory, locations, and viewpoint, then starts a new session. Existing editor nodes remain; the director will still read them as prior story and relay only what each character should know."),
      confirmLabel: tr(language, "清空并新建 Session", "Clear and start new session"),
      cancelLabel: tr(language, "取消", "Cancel"),
      intent: "danger",
      onConfirm: clearAiMemory,
    });
  }

  function clearAiMemory() {
    aiWritingRunIdRef.current += 1;
    const nextRuntime = createEmptyAiRuntime(aiSettings, true);
    setAiWritingOpen(false);
    setAiWritingSession(null);
    setAiRuntime(nextRuntime);
    saveAiRuntime(sourceName, nextRuntime);
    notifySuccess(tr(language, "AI 记忆已清空，已开启全新 Session", "AI memory cleared; a new session has started"));
  }

  async function callAiModel<T>(request: AiModelRequest, runId?: number): Promise<T> {
    if (!window.storyEditorAi) {
      throw new Error(tr(language, "AI 桥接不可用", "AI bridge is unavailable"));
    }
    let retryCount = 0;
    let activeRequest = request;
    while (true) {
      try {
        return await window.storyEditorAi.generate<T>(activeRequest);
      } catch (error) {
        const message = error instanceof Error ? error.message : tr(language, "AI 请求失败", "AI request failed");
        const providerOriginError = isProviderOriginError(message);
        const maximumRetries = providerOriginError ? 2 : isTransientAiTransportError(message) ? 3 : isRetryableAiError(message) ? 1 : 0;
        if (retryCount >= maximumRetries || (runId !== undefined && aiWritingRunIdRef.current !== runId)) {
          if (retryCount === 0) throw error;
          throw new Error(tr(language, `AI 自动重试 ${retryCount} 次后仍然失败。原因：${message}`, `AI still failed after ${retryCount} automatic retries. Reason: ${message}`));
        }
        retryCount += 1;
        const requestedRetryAfter = Number(message.match(/retry_after=(\d+)/i)?.[1] || 0) * 1000;
        const delay = providerOriginError
          ? Math.max(60000, requestedRetryAfter)
          : isTransientAiTransportError(message) ? [2000, 5000, 10000][retryCount - 1] : 1500;
        setAiWritingSession((current) => {
          if (!current || current.id !== runId) return current;
          return {
            ...current,
            progress: providerOriginError
              ? tr(language, `AI 供应商源站故障：${message} 将遵守供应商退避要求，${delay / 1000} 秒后重试（${retryCount}/${maximumRetries}）…`, `AI provider origin failure: ${message} Respecting provider backoff; retrying in ${delay / 1000}s (${retryCount}/${maximumRetries})…`)
              : tr(language, `AI 请求失败：${message} ${delay / 1000} 秒后自动重试（${retryCount}/${maximumRetries}）…`, `AI request failed: ${message} Retrying in ${delay / 1000}s (${retryCount}/${maximumRetries})…`),
          };
        });
        await new Promise((resolve) => window.setTimeout(resolve, delay));
        if (runId !== undefined && aiWritingRunIdRef.current !== runId) throw error;
      }
    }
  }

  async function callAiModelWithCorrection<T>(request: AiModelRequest, validate: (result: T) => void, runId: number, label: string): Promise<T> {
    const result = await callAiModel<T>(request, runId);
    try {
      validate(result);
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : tr(language, "返回结果违反本地规则", "The response violated local rules");
      setAiWritingSession((current) => {
        if (!current || current.id !== runId) return current;
        return { ...current, progress: tr(language, `${label}返回不合法：${reason} 正在把错误结果发回 AI 修正（1/1）…`, `${label} was invalid: ${reason} Sending the result back for correction (1/1)…`) };
      });
      const correctionRequest = {
        ...request,
        input: buildCorrectionInput(request.input, result, reason),
      };
      const corrected = await callAiModel<T>(correctionRequest, runId);
      try {
        validate(corrected);
        return corrected;
      } catch (correctionError) {
        const correctionReason = correctionError instanceof Error ? correctionError.message : tr(language, "修正结果仍违反本地规则", "The corrected response still violated local rules");
        throw new Error(tr(language, `${label}自动修正后仍不合法。原因：${correctionReason}`, `${label} was still invalid after automatic correction. Reason: ${correctionReason}`));
      }
    }
  }

  function openImportPicker() {
    let restored = false;
    const restoreOnce = () => {
      if (restored) {
        return;
      }
      restored = true;
      window.removeEventListener("focus", restoreOnce);
      restoreAppFocus({ focusSelectedEditor: true });
    };

    window.addEventListener("focus", restoreOnce);
    fileInputRef.current?.click();
    window.setTimeout(restoreOnce, 500);
  }

  function restoreAppFocus({ focusSelectedEditor = false }: { focusSelectedEditor?: boolean } = {}) {
    void window.storyEditorWindow?.focus();
    window.setTimeout(() => {
      window.focus();
      if (isEditableElement(document.activeElement)) {
        return;
      }

      if (focusSelectedEditor && rows.length > 0) {
        const rowIndex = Math.max(0, Math.min(selectedRow, rows.length - 1));
        const target = viewMode === "nodes" ? nodeRefs.current.get(rowIndex) : rowRefs.current.get(rowIndex);
        if (focusEditableElement(target)) {
          return;
        }
      }

      appRef.current?.focus({ preventScroll: true });
    }, 0);
  }

  function cancelConfirmDialog() {
    setConfirmDialog(null);
    restoreAppFocus({ focusSelectedEditor: true });
  }

  function confirmCurrentDialog() {
    const action = confirmDialog?.onConfirm;
    setConfirmDialog(null);
    action?.();
  }

  function bindRowRef(rowIndex: number) {
    return (element: HTMLTableRowElement | null) => {
      if (element) {
        rowRefs.current.set(rowIndex, element);
      } else {
        rowRefs.current.delete(rowIndex);
      }
    };
  }

  function bindNodeRef(rowIndex: number) {
    return (element: HTMLElement | null) => {
      if (element) {
        nodeRefs.current.set(rowIndex, element);
      } else {
        nodeRefs.current.delete(rowIndex);
      }
    };
  }

  function addStoryNode(kind: StoryNodeKind) {
    const result = insertStoryNode(template, rows, selectedRow, kind);
    setRows(result.rows);
    selectRow(result.insertedIndex, true, true);

    if (kind === "choice") {
      setStatus(tr(language, "已添加选项和分支对话，并自动绑定父节点与汇合节点", "Added a choice and branch dialogue, with parent and merge links bound"));
    } else if (kind === "end") {
      setStatus(tr(language, "已添加结束节点，并自动绑定到当前节点之后", "Added an end node after the current node"));
    } else if (kind === "reward") {
      setStatus(tr(language, "已添加奖励，并自动绑定父节点和下一节点", "Added a reward node with parent and next links bound"));
    } else {
      setStatus(tr(language, "已添加对话，并自动绑定父节点和下一节点", "Added a dialogue node with parent and next links bound"));
    }
  }

  function addChoiceToContext(parentIndex: number) {
    const result = insertStoryNode(template, rows, parentIndex, "choice");
    setRows(result.rows);
    selectRow(result.insertedIndex, true, true);
    setStatus(tr(language, "已在当前分支组添加选项，并自动绑定分支首句", "Added a choice to the current branch group"));
  }

  function deleteRow(rowIndex: number) {
    const next = deleteStoryNode(rows, rowIndex);
    const nextSelectedRow = Math.max(0, Math.min(rowIndex, next.length - 1));
    setRows(next);
    if (next.length > 0) {
      selectRow(nextSelectedRow, true, true);
    } else {
      pendingScrollRowRef.current = null;
      pendingEditorFocusRowRef.current = null;
      setSelectedRow(0);
      restoreAppFocus();
    }
    setStatus(tr(language, "已删除节点，并自动修复线性跳转", "Deleted the node and repaired linear skip links"));
  }

  function clearTable() {
    setConfirmDialog({
      title: tr(language, "清空表格", "Clear Table"),
      message: tr(language, "确认清空当前表格？所有节点都会被删除，并覆盖本地草稿。", "Clear the current table? All nodes will be deleted and the local draft will be overwritten."),
      confirmLabel: tr(language, "清空", "Clear"),
      cancelLabel: tr(language, "取消", "Cancel"),
      confirmFirst: true,
      intent: "danger",
      onConfirm: performClearTable,
    });
  }

  function performClearTable() {
    const clearedRows: StoryRow[] = [];
    const draft = saveDraft({ sourceName, template, rows: clearedRows, selectedRow: 0 });
    pendingScrollRowRef.current = null;
    pendingEditorFocusRowRef.current = null;
    rowRefs.current.clear();
    nodeRefs.current.clear();
    setRows(clearedRows);
    setSelectedRow(0);
    setLastSavedAt(draft.savedAt);
    setHasUnsavedChanges(false);
    lastSavedSnapshotRef.current = makeDraftSnapshot({ sourceName, template, rows: clearedRows, selectedRow: 0 });
    setStatus(tr(language, `表格已清空：${formatSavedAt(draft.savedAt)}`, `Table cleared: ${formatSavedAt(draft.savedAt)}`));
    restoreAppFocus();
  }

  async function exportCsv() {
    try {
      const exportRows = ensureFirstBeginFlag(rows);
      const blob = new Blob([exportCsvText(template, exportRows)], { type: "text/csv;charset=utf-8" });
      const result = await saveBlob(blob, filenameWithExt(sourceName, "csv"), [
        { name: "CSV", extensions: ["csv"] },
        { name: tr(language, "所有文件", "All Files"), extensions: ["*"] },
      ]);
      if (result.state === "canceled") {
        setStatus(tr(language, "CSV 导出已取消", "CSV export canceled"));
        return;
      }
      notifySuccess(result.state === "saved" ? tr(language, "CSV 已保存", "CSV saved") : tr(language, "CSV 已开始下载", "CSV download started"));
    } catch (error) {
      setStatus(error instanceof Error ? tr(language, `CSV 导出失败：${error.message}`, `CSV export failed: ${error.message}`) : tr(language, "CSV 导出失败", "CSV export failed"));
    } finally {
      restoreAppFocus({ focusSelectedEditor: true });
    }
  }

  async function exportXlsx() {
    try {
      const buffer = exportWorkbookBuffer(template, ensureFirstBeginFlag(rows));
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const result = await saveBlob(blob, filenameWithExt(sourceName, "xlsx"), [
        { name: "Excel Workbook", extensions: ["xlsx"] },
        { name: tr(language, "所有文件", "All Files"), extensions: ["*"] },
      ]);
      if (result.state === "canceled") {
        setStatus(tr(language, "XLSX 导出已取消", "XLSX export canceled"));
        return;
      }
      notifySuccess(result.state === "saved" ? tr(language, "XLSX 已保存", "XLSX saved") : tr(language, "XLSX 已开始下载", "XLSX download started"));
    } catch (error) {
      setStatus(error instanceof Error ? tr(language, `XLSX 导出失败：${error.message}`, `XLSX export failed: ${error.message}`) : tr(language, "XLSX 导出失败", "XLSX export failed"));
    } finally {
      restoreAppFocus({ focusSelectedEditor: true });
    }
  }

  function handleSaveTemplate() {
    saveTemplate(template);
    notifySuccess(tr(language, "模板已保存到本机浏览器", "Template saved locally"));
  }

  function applyBatchReplace() {
    try {
      setUndoRows(rows);
      const result = applyReplacement(rows, replaceOptions);
      setRows(result.rows);
      setStatus(tr(language, `替换 ${result.matches} 处，影响 ${result.affectedCells} 个单元格`, `Replaced ${result.matches} matches in ${result.affectedCells} cells`));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : tr(language, "替换表达式无效", "Invalid replace expression"));
    }
  }

  function restoreReplace() {
    if (!undoRows) {
      return;
    }
    setRows(undoRows);
    setUndoRows(null);
    setStatus(tr(language, "已撤销上一次替换", "Reverted the last replacement"));
  }

  function addColumn() {
    const key = nextColumnKey(template);
    const column: ColumnTemplate = { key, valueType: "string", label: tr(language, "新字段", "New Field"), channel: "c", isLang: false };
    setTemplate((current) => ({ ...current, columns: [...current.columns, column] }));
    setRows((current) => current.map((row) => ({ ...row, [key]: "" })));
  }

  function removeColumn(key: string) {
    setConfirmDialog({
      title: tr(language, "删除字段", "Delete Field"),
      message: tr(language, `删除字段 ${key}？`, `Delete field ${key}?`),
      confirmLabel: tr(language, "删除", "Delete"),
      cancelLabel: tr(language, "取消", "Cancel"),
      intent: "danger",
      onConfirm: () => performRemoveColumn(key),
    });
  }

  function performRemoveColumn(key: string) {
    setTemplate((current) => ({ ...current, columns: current.columns.filter((column) => column.key !== key) }));
    setRows((current) => removeColumnFromRows(current, key));
    setReplaceOptions((current) => ({ ...current, columns: current.columns.filter((columnKey) => columnKey !== key) }));
    restoreAppFocus({ focusSelectedEditor: true });
  }

  function updateColumn(index: number, patch: Partial<ColumnTemplate>) {
    setTemplate((current) => {
      const existing = current.columns[index];
      if (!existing) {
        return current;
      }

      if (patch.key && patch.key !== existing.key) {
        const cleanKey = patch.key.trim();
        if (!cleanKey || current.columns.some((column, columnIndex) => columnIndex !== index && column.key === cleanKey)) {
          setStatus(tr(language, "字段名不能为空，也不能重复", "Field names cannot be empty or duplicated"));
          return current;
        }
        setRows((currentRows) => updateColumnKey(currentRows, existing.key, cleanKey));
        setReplaceOptions((currentOptions) => ({
          ...currentOptions,
          columns: currentOptions.columns.map((columnKey) => (columnKey === existing.key ? cleanKey : columnKey)),
        }));
      }

      const columns = current.columns.map((column, columnIndex) =>
        columnIndex === index ? { ...column, ...patch, key: patch.key?.trim() ?? column.key } : column,
      );
      return { ...current, columns };
    });
  }

  function moveColumn(index: number, direction: -1 | 1) {
    setTemplate((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.columns.length) {
        return current;
      }
      const columns = [...current.columns];
      const [column] = columns.splice(index, 1);
      columns.splice(nextIndex, 0, column);
      return { ...current, columns };
    });
  }

  function toggleReplaceColumn(key: string) {
    setReplaceOptions((current) => ({
      ...current,
      columns: current.columns.includes(key)
        ? current.columns.filter((columnKey) => columnKey !== key)
        : [...current.columns, key],
    }));
  }

  function updateCharacterLimit(value: string) {
    if (value.trim() === "") {
      setCharacterLimit(null);
      return;
    }

    const next = Number(value);
    if (Number.isFinite(next) && next > 0) {
      setCharacterLimit(Math.floor(next));
    }
  }

  function jumpToNodeId(id: string) {
    const rowIndex = rows.findIndex((row) => row.id === id);
    if (rowIndex >= 0) {
      selectRow(rowIndex, true);
    }
  }

  function moveGraphNode(rowId: string, position: NodePosition) {
    setNodePositions((current) => ({ ...current, [rowId]: position }));
  }

  function connectGraphNodes(kind: GraphLinkKind, sourceIndex: number, targetIndex: number) {
    const source = rows[sourceIndex];
    const target = rows[targetIndex];
    if (!source?.id || !target?.id || sourceIndex === targetIndex) {
      return;
    }

    if (kind !== "skip") {
      return;
    }

    const optionIndexes = target.sign === "&" ? getChoiceGroupIndexes(rows, targetIndex) : [];
    if (optionIndexes.length > 0) {
      const firstOptionIndex = firstChoiceIndex(rows, optionIndexes);
      const firstOption = rows[firstOptionIndex];
      setRows((current) =>
        current.map((row, index) => {
          if (index === sourceIndex) {
            return { ...row, skip: firstOption.id };
          }
          if (optionIndexes.includes(index)) {
            return { ...row, parent_id: source.id };
          }
          return row;
        }),
      );
      selectRow(sourceIndex);
      setStatus(tr(language, `已连到选项组：${source.id} -> ${firstOption.id}`, `Connected to choice group: ${source.id} -> ${firstOption.id}`));
      return;
    }

    setRows((current) =>
      current.map((row, index) => {
        if (index === sourceIndex) {
          return { ...row, skip: target.id };
        }
        if (index === targetIndex) {
          return { ...row, parent_id: source.id };
        }
        return row;
      }),
    );
    selectRow(sourceIndex);
    setStatus(tr(language, `已连线：${source.id} -> ${target.id}`, `Connected: ${source.id} -> ${target.id}`));
  }

  function clearGraphLink(rowIndex: number, kind: GraphLinkKind) {
    const row = rows[rowIndex];
    if (!row) {
      return;
    }

    if (kind === "skip") {
      updateCell(rowIndex, "skip", "");
      setStatus(tr(language, `已清空 ${row.id || rowIndex + 1} 的跳转连线`, `Cleared skip link for ${row.id || rowIndex + 1}`));
    }
  }

  function createDetachedGraphNode(kind: StoryNodeKind, position: NodePosition) {
    const node = createDetachedStoryNode(template, rows, kind);
    const nextRows = ensureFirstBeginFlag([...rows, node]);
    const insertedIndex = nextRows.length - 1;
    setRows(nextRows);
    if (node.id) {
      setNodePositions((current) => ({ ...current, [node.id]: position }));
    }
    selectRow(insertedIndex, true, true);
    setStatus(tr(language, "已拖出新节点，尚未自动绑定连线", "Created a detached node without automatic links"));
  }

  return (
    <main
      ref={appRef}
      className={`app ${dragging ? "is-dragging" : ""}`}
      data-drop-label={tr(language, "释放文件导入", "Drop file to import")}
      tabIndex={-1}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void handleFiles(event.dataTransfer.files);
      }}
    >
      <header className="toolbar">
        <div className="brand">
          <FileSpreadsheet size={24} aria-hidden="true" />
          <div>
            <h1>{tr(language, "剧情编辑器", "Story Editor")}</h1>
            <span>{sourceName}</span>
          </div>
        </div>
        <div className="toolbar-actions">
          <input ref={fileInputRef} hidden type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void handleFiles(event.target.files)} />
          <button type="button" onClick={openImportPicker}>
            <Upload size={16} aria-hidden="true" />
            {tr(language, "导入", "Import")}
          </button>
          <button type="button" className="ai-writing-button" onClick={() => void openAiWriter()}>
            <Sparkles size={16} aria-hidden="true" />
            {tr(language, "AI 编写", "AI Writing")}
          </button>
          <button type="button" onClick={() => { void refreshAiApiStatus(); setAiSettingsOpen(true); }}>
            <Settings size={16} aria-hidden="true" />
            {tr(language, "AI 设定", "AI Settings")}
          </button>
          <button type="button" className="danger-button" onClick={requestClearAiMemory}>
            <Trash2 size={16} aria-hidden="true" />
            {tr(language, "清空 AI 记忆", "Clear AI Memory")}
          </button>
          <button type="button" className="script-preprocess-button" onClick={() => void preprocessScriptFromClipboard()}>
            <ClipboardPaste size={16} aria-hidden="true" />
            {tr(language, "剧本预处理", "Preprocess")}
          </button>
          <button type="button" onClick={() => void exportCsv()}>
            <Download size={16} aria-hidden="true" />
            CSV
          </button>
          <button type="button" onClick={() => void exportXlsx()}>
            <FileSpreadsheet size={16} aria-hidden="true" />
            XLSX
          </button>
          <button type="button" onClick={handleSaveTemplate}>
            <Save size={16} aria-hidden="true" />
            {tr(language, "保存模板", "Save Template")}
          </button>
          <button type="button" onClick={() => persistDraft("manual")}>
            <Save size={16} aria-hidden="true" />
            {tr(language, "保存进度", "Save Progress")}
          </button>
          <div className="view-toggle" role="group" aria-label={tr(language, "视图切换", "View switch")}>
            <button type="button" className={viewMode === "table" ? "active" : ""} onClick={() => setViewMode("table")}>
              <Table2 size={16} aria-hidden="true" />
              {tr(language, "表格", "Table")}
            </button>
            <button type="button" className={viewMode === "nodes" ? "active" : ""} onClick={() => setViewMode("nodes")}>
              <Network size={16} aria-hidden="true" />
              {tr(language, "节点", "Nodes")}
            </button>
          </div>
          <div className="view-toggle language-toggle" role="group" aria-label={tr(language, "语言切换", "Language switch")}>
            <Languages size={15} aria-hidden="true" />
            <button type="button" className={language === "zh" ? "active" : ""} onClick={() => setLanguage("zh")}>
              中
            </button>
            <button type="button" className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>
              EN
            </button>
          </div>
          <button type="button" onClick={clearTable}>
            <Trash2 size={16} aria-hidden="true" />
            {tr(language, "清空表格", "Clear")}
          </button>
        </div>
      </header>

      {toast && <div className="toast success">{toast}</div>}
      {confirmDialog && (
        <ConfirmModal
          dialog={confirmDialog}
          onCancel={cancelConfirmDialog}
          onConfirm={confirmCurrentDialog}
        />
      )}
      {aiSettingsOpen && (
        <AiSettingsModal
          settings={aiSettings}
          apiStatus={aiApiStatus}
          language={language}
          onClose={() => setAiSettingsOpen(false)}
          onSave={persistAiConfiguration}
        />
      )}
      {aiWritingOpen && (
        <AiWritingModal
          settings={aiSettings}
          runtime={aiRuntime}
          language={language}
          onClose={() => setAiWritingOpen(false)}
          onStart={(options) => { void generateAiStory(options).catch((error) => setStatus(error instanceof Error ? error.message : tr(language, "AI 编写失败", "AI writing failed"))); }}
        />
      )}
      {aiWritingSession && (
        <AiWritingProgressModal
          session={aiWritingSession}
          settings={aiSettings}
          language={language}
          onDiscard={discardAiWritingResult}
          onStop={stopAiWriting}
          onRetry={retryAiWriting}
          onConfirm={confirmAiWritingResult}
        />
      )}

      <section className="status-strip">
        <span>{status}</span>
        <span>{tr(language, `${rows.length} 个节点`, `${rows.length} nodes`)}</span>
        <span>{tr(language, `显示 ${editorColumns.length} 项`, `${editorColumns.length} visible`)}</span>
        <span>{tr(language, `导出 ${template.columns.length} 列`, `${template.columns.length} export columns`)}</span>
        <span>{tr(language, `字数上限 ${characterLimit ?? "不校验"}`, `Character limit ${characterLimit ?? "off"}`)}</span>
        {newlineValidationEnabled && <span>{tr(language, "换行符校验 开", "Line break check on")}</span>}
        {rightSideRoleKeyword.trim() && <span>{tr(language, `右侧人物 ${rightSideRoleKeyword.trim()}`, `Right-side role ${rightSideRoleKeyword.trim()}`)}</span>}
        <span className={hasUnsavedChanges ? "bad" : "good"}>
          {hasUnsavedChanges
            ? tr(language, "未保存", "Unsaved")
            : lastSavedAt
              ? tr(language, `已保存 ${formatSavedAt(lastSavedAt)}`, `Saved ${formatSavedAt(lastSavedAt)}`)
              : tr(language, "未生成草稿", "No draft")}
        </span>
        <span className={issues.some((issue) => issue.level === "error") ? "bad" : "good"}>
          {issues.length === 0 ? tr(language, "无校验问题", "No validation issues") : tr(language, `${issues.length} 个校验提示`, `${issues.length} validation issues`)}
        </span>
      </section>

      <div className="workspace">
        <section className={`editor-pane ${viewMode === "nodes" ? "node-editor-pane" : ""}`}>
          {viewMode === "table" ? (
            <>
              <div className="table-wrap">
                <table className="story-table">
                  <thead>
                    <tr>
                      <th className="row-head">#</th>
                      {editorColumns.map((column) => (
                        <th key={column.key}>
                          <span>{column.label || column.key}</span>
                          <small>{column.key}</small>
                        </th>
                      ))}
                      <th className="row-head"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td className="empty-table" colSpan={editorColumns.length + 2}>
                          {tr(language, "导入表格，或点击“添加对话”开始新剧情。", "Import a table, or click Add Dialogue to start a new story.")}
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, rowIndex) => (
                        <tr
                          key={`${row.id || "row"}-${rowIndex}`}
                          ref={bindRowRef(rowIndex)}
                          className={rowClassName(selectedRow === rowIndex, lengthWarningRows.has(rowIndex), positionWarningRows.has(rowIndex))}
                        >
                          <td className="row-head">
                            <button type="button" title={tr(language, "选中节点", "Select node")} className="row-number" onClick={() => selectRow(rowIndex)}>
                              {rowIndex + 1}
                            </button>
                          </td>
                          {editorColumns.map((column) => (
                            <td key={column.key} className={column.key === "content" ? "content-cell" : undefined}>
                              <EditableCell
                                column={column}
                                row={row}
                                rowIndex={rowIndex}
                                onFocus={selectRow}
                                onChange={updateCell}
                                characterLimit={characterLimit}
                                isOverLimit={lengthWarningRows.has(rowIndex)}
                                language={language}
                              />
                            </td>
                          ))}
                          <td className="row-head">
                            <button type="button" title={tr(language, "删除节点", "Delete node")} className="icon-button danger" onClick={() => deleteRow(rowIndex)}>
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <NodeActionBar className="table-node-action-bar" language={language} onAddNode={addStoryNode} />
            </>
          ) : (
            <NodeGraphView
              rows={rows}
              selectedRow={selectedRow}
              graphEdges={graphEdges}
              lengthWarningRows={lengthWarningRows}
              nodePositions={nodePositions}
              positionWarningRows={positionWarningRows}
              characterLimit={characterLimit}
              language={language}
              bindNodeRef={bindNodeRef}
              onChange={updateCell}
              onClearLink={clearGraphLink}
              onConnect={connectGraphNodes}
              onCreateNode={createDetachedGraphNode}
              onDelete={deleteRow}
              onJumpToNode={jumpToNodeId}
              onMoveNode={moveGraphNode}
              onSelect={selectRow}
            />
          )}
        </section>

        <aside className="side-pane">
          <section className="panel">
            <div className="panel-title">
              <FileSpreadsheet size={17} aria-hidden="true" />
              <h2>{tr(language, "文件信息", "File Info")}</h2>
            </div>
            <label className="file-name-field">
              {tr(language, "文件名", "File Name")}
              <input value={sourceName} onChange={(event) => setSourceName(event.target.value)} />
            </label>
          </section>

          <section className="panel preview-panel">
            <div className="panel-title">
              <CheckCircle2 size={17} aria-hidden="true" />
              <h2>{tr(language, "预览", "Preview")}</h2>
            </div>
            <dl className="node-meta">
              <div>
                <dt>{tr(language, "类型", "Type")}</dt>
                <dd>{rows.length === 0 ? "-" : nodeTypeLabel(selected, language)}</dd>
              </div>
              <div>
                <dt>{tr(language, "角色", "Role")}</dt>
                <dd>{selected.role || tr(language, "旁白", "Narrator")}</dd>
              </div>
              <div>
                <dt>{tr(language, "位置", "Position")}</dt>
                <dd>{selected.boxPos === "r" ? tr(language, "右", "Right") : tr(language, "左", "Left")}</dd>
              </div>
              <div>
                <dt>{tr(language, "字数", "Characters")}</dt>
                <dd>{countCharacters(selected.content || "")}</dd>
              </div>
            </dl>
            <p className={`dialogue ${selected.boxPos === "r" ? "right" : "left"}`}>
              {selected.reward
                ? tr(language, `奖励：${selected.reward}`, `Reward: ${selected.reward}`)
                : selected.content || tr(language, "当前节点没有正文内容", "The current node has no content")}
            </p>
          </section>

          {rows.length > 0 && (
            <section className="panel">
              <div className="panel-title">
                <GitBranch size={17} aria-hidden="true" />
                <h2>{tr(language, "选项配置", "Choice Config")}</h2>
              </div>
              {choiceContext ? (
                <>
                  <p className="panel-note">
                    {tr(language, "同组选项会从同一句对话分出，分支首句会自动接回共同后续节点。", "Choices in the same group branch from one dialogue, and branch starts reconnect to the shared next node.")}
                  </p>
                  <div className="choice-list">
                    {choiceContext.choices.map((choice, index) => (
                      <div className="choice-editor" key={choice.option.id || index}>
                        <label>
                          {tr(language, "选项文本", "Choice Text")}
                          <input
                            value={choice.option.content ?? ""}
                            onFocus={() => selectRow(choice.optionIndex)}
                            onChange={(event) => updateCell(choice.optionIndex, "content", event.target.value)}
                          />
                        </label>
                        <label>
                          {tr(language, "分支首句", "Branch Start")}
                          <textarea
                            value={choice.dialogue?.content ?? ""}
                            onKeyDown={handleTextareaKeyDown}
                            onPaste={(event) =>
                              choice.dialogueIndex >= 0 &&
                              handleTextareaPaste(event, choice.dialogue?.content ?? "", (value) => updateCell(choice.dialogueIndex, "content", value))
                            }
                            onFocus={() => choice.dialogueIndex >= 0 && selectRow(choice.dialogueIndex)}
                            onChange={(event) => choice.dialogueIndex >= 0 && updateCell(choice.dialogueIndex, "content", event.target.value)}
                          />
                        </label>
                        <div className="choice-actions">
                          <button type="button" onClick={() => selectRow(choice.optionIndex, true)}>
                            {tr(language, "选项行", "Choice Row")}
                          </button>
                          <button type="button" onClick={() => choice.dialogueIndex >= 0 && selectRow(choice.dialogueIndex, true)} disabled={choice.dialogueIndex < 0}>
                            {tr(language, "分支行", "Branch Row")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => addChoiceToContext(choiceContext.parentIndex)}>
                    <Plus size={16} aria-hidden="true" />
                    {tr(language, "添加同组选项", "Add Group Choice")}
                  </button>
                </>
              ) : selected.sign !== "END" && selected.sign !== "$" ? (
                <button type="button" onClick={() => addStoryNode("choice")}>
                  <Plus size={16} aria-hidden="true" />
                  {tr(language, "给当前对话添加选项", "Add Choice To Dialogue")}
                </button>
              ) : (
                <p className="empty">{tr(language, "当前节点不需要配置选项", "The current node does not need choice config")}</p>
              )}
            </section>
          )}

          {rows.length > 0 && selected.sign === "#" && dialogueConfigColumns.length > 0 && (
            <section className="panel">
              <div className="panel-title">
                <Settings size={17} aria-hidden="true" />
                <h2>{tr(language, "对话配置", "Dialogue Config")}</h2>
              </div>
              <div className="dialogue-config">
                {dialogueConfigColumns.map((column) => (
                  <label key={column.key}>
                    {column.label || column.key}
                    <input value={selected[column.key] ?? ""} onChange={(event) => updateCell(selectedRow, column.key, event.target.value)} />
                  </label>
                ))}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-title">
              <Search size={17} aria-hidden="true" />
              <h2>{tr(language, "批量替换", "Batch Replace")}</h2>
            </div>
            <div className="form-grid">
              <label>
                {tr(language, "查找", "Find")}
                <input value={replaceOptions.find} onChange={(event) => setReplaceOptions((current) => ({ ...current, find: event.target.value }))} />
              </label>
              <label>
                {tr(language, "替换为", "Replace With")}
                <input value={replaceOptions.replace} onChange={(event) => setReplaceOptions((current) => ({ ...current, replace: event.target.value }))} />
              </label>
            </div>
            <div className="check-row">
              <label>
                <input type="checkbox" checked={replaceOptions.useRegex} onChange={(event) => setReplaceOptions((current) => ({ ...current, useRegex: event.target.checked }))} />
                {tr(language, "正则", "Regex")}
              </label>
              <label>
                <input type="checkbox" checked={replaceOptions.matchCase} onChange={(event) => setReplaceOptions((current) => ({ ...current, matchCase: event.target.checked }))} />
                {tr(language, "区分大小写", "Match Case")}
              </label>
            </div>
            <div className="column-pills">
              {editorColumns.map((column) => (
                <label key={column.key} className={replaceOptions.columns.includes(column.key) ? "pill active" : "pill"}>
                  <input type="checkbox" checked={replaceOptions.columns.includes(column.key)} onChange={() => toggleReplaceColumn(column.key)} />
                  {column.label || column.key}
                </label>
              ))}
            </div>
            <div className="button-row">
              <button type="button" onClick={applyBatchReplace} disabled={!replaceOptions.find}>
                <Search size={16} aria-hidden="true" />
                {tr(language, `替换 ${replacePreview.matches}`, `Replace ${replacePreview.matches}`)}
              </button>
              <button type="button" onClick={restoreReplace} disabled={!undoRows}>
                <Undo2 size={16} aria-hidden="true" />
                {tr(language, "撤销", "Undo")}
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <AlertTriangle size={17} aria-hidden="true" />
              <h2>{tr(language, "校验", "Validation")}</h2>
            </div>
            <label className="limit-field">
              {tr(language, "每行字数上限", "Character Limit Per Row")}
              <input min={1} placeholder={tr(language, "留空不校验", "Empty to disable")} type="number" value={characterLimit ?? ""} onChange={(event) => updateCharacterLimit(event.target.value)} />
            </label>
            <label className="limit-field">
              {tr(language, "人物靠右校验", "Right-side Role Check")}
              <input placeholder={tr(language, "$player，留空不校验", "$player, empty to disable")} value={rightSideRoleKeyword} onChange={(event) => setRightSideRoleKeyword(event.target.value)} />
            </label>
            <div className="check-row validation-check-row">
              <label>
                <input type="checkbox" checked={newlineValidationEnabled} onChange={(event) => setNewlineValidationEnabled(event.target.checked)} />
                {tr(language, "正文换行符校验", "Content Line Break Check")}
              </label>
            </div>
            {characterIssues.length > 0 && characterLimit !== null && (
              <p className="panel-note">{tr(language, `${characterIssues.length} 行超过 ${characterLimit} 字，已在表格/节点中红色标出。`, `${characterIssues.length} rows exceed ${characterLimit} characters and are highlighted red in the table/nodes.`)}</p>
            )}
            {newlineIssues.length > 0 && newlineValidationEnabled && (
              <p className="panel-note">{tr(language, `${newlineIssues.length} 行正文包含换行符，已在表格/节点中红色标出。`, `${newlineIssues.length} rows contain line breaks and are highlighted red in the table/nodes.`)}</p>
            )}
            {rightSideRoleIssues.length > 0 && (
              <p className="panel-note">{tr(language, `${rightSideRoleIssues.length} 行人物包含 ${rightSideRoleKeyword.trim()} 但位置不是右侧，已在表格/节点中黄色标出。`, `${rightSideRoleIssues.length} rows contain ${rightSideRoleKeyword.trim()} but are not on the right side; they are highlighted yellow in the table/nodes.`)}</p>
            )}
            <div className="issue-list">
              {issues.length === 0 ? (
                <p className="empty">{tr(language, "结构看起来正常", "Structure looks good")}</p>
              ) : (
                issues.slice(0, 30).map((issue, index) => (
                  <button
                    key={`${issue.message}-${index}`}
                    type="button"
                    className={`issue ${issue.level}${issue.kind ? ` ${issue.kind}` : ""}`}
                    onClick={() => issue.rowIndex >= 0 && selectRow(issue.rowIndex, true)}
                  >
                    <strong>{issue.rowIndex >= 0 ? tr(language, `第 ${issue.rowIndex + 1} 个节点`, `Node ${issue.rowIndex + 1}`) : tr(language, "全表", "Whole Table")}</strong>
                    <span>{issue.message}</span>
                  </button>
                ))
              )}
            </div>
          </section>

          <details className="panel template-panel">
            <summary className="panel-title">
              <Settings size={17} aria-hidden="true" />
              <h2>{tr(language, "表结构", "Table Schema")}</h2>
            </summary>
            <div className="template-name">
              <input value={template.name} onChange={(event) => setTemplate((current) => ({ ...current, name: event.target.value }))} />
              <button type="button" title={tr(language, "新增字段", "Add Field")} className="icon-button" onClick={addColumn}>
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="columns-editor">
              {template.columns.map((column, index) => (
                <div className="column-editor" key={column.key}>
                  <input aria-label={tr(language, "字段名", "Field Key")} value={column.key} onChange={(event) => updateColumn(index, { key: event.target.value })} />
                  <input aria-label={tr(language, "类型", "Type")} value={column.valueType} onChange={(event) => updateColumn(index, { valueType: event.target.value })} />
                  <input aria-label={tr(language, "中文名", "Label")} value={column.label} onChange={(event) => updateColumn(index, { label: event.target.value, isLang: event.target.value.includes("#Lang") })} />
                  <input aria-label={tr(language, "端侧", "Channel")} value={column.channel} onChange={(event) => updateColumn(index, { channel: event.target.value })} />
                  <label title={tr(language, "多语言字段", "Language Field")}>
                    <input type="checkbox" checked={column.isLang} onChange={(event) => updateColumn(index, { isLang: event.target.checked })} />
                    Lang
                  </label>
                  <button type="button" title={tr(language, "上移", "Move Up")} className="icon-button" onClick={() => moveColumn(index, -1)}>
                    <ArrowUp size={14} aria-hidden="true" />
                  </button>
                  <button type="button" title={tr(language, "下移", "Move Down")} className="icon-button" onClick={() => moveColumn(index, 1)}>
                    <ArrowDown size={14} aria-hidden="true" />
                  </button>
                  <button type="button" title={tr(language, "删除字段", "Delete Field")} className="icon-button danger" onClick={() => removeColumn(column.key)}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </details>
        </aside>
      </div>
    </main>
  );
}

function ConfirmModal({
  dialog,
  onCancel,
  onConfirm,
}: {
  dialog: ConfirmDialog;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelButton = (
    <button type="button" onClick={onCancel} autoFocus>
      {dialog.cancelLabel}
    </button>
  );
  const confirmButton = (
    <button type="button" className={dialog.intent === "danger" ? "danger-button" : undefined} onClick={onConfirm}>
      {dialog.confirmLabel}
    </button>
  );

  return (
    <div
      className="confirm-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onCancel();
          }
        }}
      >
        <div className={`confirm-icon ${dialog.intent === "danger" ? "danger" : ""}`}>
          <AlertTriangle size={20} aria-hidden="true" />
        </div>
        <div className="confirm-content">
          <h2 id="confirm-title">{dialog.title}</h2>
          <p>{dialog.message}</p>
          <div className="confirm-actions">
            {dialog.confirmFirst ? (
              <>
                {confirmButton}
                {cancelButton}
              </>
            ) : (
              <>
                {cancelButton}
                {confirmButton}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function NodeActionBar({ className = "", language, onAddNode }: { className?: string; language: AppLanguage; onAddNode: (kind: StoryNodeKind) => void }) {
  return (
    <div className={`node-action-bar ${className}`}>
      <button type="button" className="dialogue-button" onClick={() => onAddNode("dialogue")}>
        <MessageSquare size={16} aria-hidden="true" />
        {storyNodeKindText("dialogue", language)}
      </button>
      <button type="button" onClick={() => onAddNode("choice")}>
        <GitBranch size={16} aria-hidden="true" />
        {storyNodeKindText("choice", language)}
      </button>
      <button type="button" onClick={() => onAddNode("reward")}>
        <Gift size={16} aria-hidden="true" />
        {storyNodeKindText("reward", language)}
      </button>
      <button type="button" onClick={() => onAddNode("end")}>
        <Octagon size={16} aria-hidden="true" />
        {storyNodeKindText("end", language)}
      </button>
    </div>
  );
}

function GraphNodePalette({
  className = "",
  language,
  onStartCreate,
}: {
  className?: string;
  language: AppLanguage;
  onStartCreate: (kind: StoryNodeKind, event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const items: Array<{ kind: StoryNodeKind; icon: typeof MessageSquare }> = [
    { kind: "dialogue", icon: MessageSquare },
    { kind: "choice", icon: GitBranch },
    { kind: "reward", icon: Gift },
    { kind: "end", icon: Octagon },
  ];

  return (
    <div className={`node-action-bar graph-node-palette ${className}`}>
      {items.map(({ kind, icon: Icon }) => (
        <button
          type="button"
          key={kind}
          className={kind === "dialogue" ? "dialogue-button" : undefined}
          title={tr(language, `拖到画布${storyNodeKindText(kind, language)}`, `Drag to canvas: ${storyNodeKindText(kind, language)}`)}
          onPointerDown={(event) => onStartCreate(kind, event)}
        >
          <Icon size={16} aria-hidden="true" />
          {storyNodeKindText(kind, language)}
        </button>
      ))}
    </div>
  );
}

function NodeGraphView({
  rows,
  selectedRow,
  graphEdges,
  lengthWarningRows,
  nodePositions,
  positionWarningRows,
  characterLimit,
  language,
  bindNodeRef,
  onClearLink,
  onChange,
  onConnect,
  onCreateNode,
  onDelete,
  onJumpToNode,
  onMoveNode,
  onSelect,
}: {
  rows: StoryRow[];
  selectedRow: number;
  graphEdges: GraphEdge[];
  lengthWarningRows: Set<number>;
  nodePositions: Record<string, NodePosition>;
  positionWarningRows: Set<number>;
  characterLimit: number | null;
  language: AppLanguage;
  bindNodeRef: (rowIndex: number) => (element: HTMLElement | null) => void;
  onClearLink: (rowIndex: number, kind: GraphLinkKind) => void;
  onChange: (rowIndex: number, key: string, value: string) => void;
  onConnect: (kind: GraphLinkKind, sourceIndex: number, targetIndex: number) => void;
  onCreateNode: (kind: StoryNodeKind, position: NodePosition) => void;
  onDelete: (rowIndex: number) => void;
  onJumpToNode: (id: string) => void;
  onMoveNode: (rowId: string, position: NodePosition) => void;
  onSelect: (rowIndex: number, scrollIntoView?: boolean) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragNode, setDragNode] = useState<{
    rowId: string;
    startClientX: number;
    startClientY: number;
    origin: NodePosition;
  } | null>(null);
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDrag | null>(null);
  const [paletteDrag, setPaletteDrag] = useState<PaletteDrag | null>(null);
  const [panDrag, setPanDrag] = useState<CanvasPanDrag | null>(null);
  const canvasSize = useMemo(() => getGraphCanvasSize(rows, nodePositions), [nodePositions, rows]);

  useEffect(() => {
    if (!dragNode) {
      return;
    }
    const activeDrag = dragNode;

    function handlePointerMove(event: PointerEvent) {
      const next = {
        x: Math.max(GRAPH_PADDING, activeDrag.origin.x + event.clientX - activeDrag.startClientX),
        y: Math.max(GRAPH_PADDING, activeDrag.origin.y + event.clientY - activeDrag.startClientY),
      };
      onMoveNode(activeDrag.rowId, next);
    }

    function handlePointerUp() {
      setDragNode(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragNode, onMoveNode]);

  useEffect(() => {
    if (!connectionDrag) {
      return;
    }
    const activeConnection = connectionDrag;

    function handlePointerMove(event: PointerEvent) {
      setConnectionDrag((current) => (current ? { ...current, pointer: clientPointToCanvas(event, canvasRef.current) } : current));
    }

    function handlePointerUp(event: PointerEvent) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-node-index]");
      const targetIndex = Number(target?.dataset.nodeIndex);
      if (Number.isInteger(targetIndex) && targetIndex >= 0) {
        onConnect(activeConnection.kind, activeConnection.sourceIndex, targetIndex);
      }
      setConnectionDrag(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [connectionDrag, onConnect]);

  useEffect(() => {
    if (!paletteDrag) {
      return;
    }
    const activePalette = paletteDrag;

    function handlePointerMove(event: PointerEvent) {
      setPaletteDrag((current) => (current ? { ...current, pointer: clientPointToCanvas(event, canvasRef.current) } : current));
    }

    function handlePointerUp(event: PointerEvent) {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const isInside =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom;
        if (isInside) {
          const point = clientPointToCanvas(event, canvas);
          onCreateNode(activePalette.kind, {
            x: Math.max(GRAPH_PADDING, point.x - GRAPH_NODE_WIDTH / 2),
            y: Math.max(GRAPH_PADDING, point.y - 32),
          });
        }
      }
      setPaletteDrag(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [onCreateNode, paletteDrag]);

  useEffect(() => {
    if (!panDrag) {
      return;
    }
    const activePan = panDrag;

    function handlePointerMove(event: PointerEvent) {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      canvas.scrollLeft = activePan.scrollLeft - (event.clientX - activePan.startClientX);
      canvas.scrollTop = activePan.scrollTop - (event.clientY - activePan.startClientY);
    }

    function handlePointerUp() {
      setPanDrag(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [panDrag]);

  return (
    <div className="node-view">
      <div className="node-view-head">
        <div>
          <h2>{tr(language, "节点流程图", "Node Flow")}</h2>
          <span>{tr(language, "拖出节点后再拉线，连线会自动维护父节点和跳转。", "Drag nodes out first, then draw links. Links maintain parent and skip fields automatically.")}</span>
        </div>
        <GraphNodePalette
          className="node-view-actions"
          language={language}
          onStartCreate={(kind, event) => {
            event.preventDefault();
            setPaletteDrag({ kind, pointer: clientPointToCanvas(event.nativeEvent, canvasRef.current) });
          }}
        />
      </div>

      <div
        className={`node-canvas${connectionDrag ? " connecting" : ""}${panDrag ? " panning" : ""}`}
        ref={canvasRef}
        onPointerDown={(event) => {
          if (event.button !== 1) {
            return;
          }
          event.preventDefault();
          setPanDrag({
            startClientX: event.clientX,
            startClientY: event.clientY,
            scrollLeft: event.currentTarget.scrollLeft,
            scrollTop: event.currentTarget.scrollTop,
          });
        }}
      >
        <div className="node-canvas-content" style={{ width: canvasSize.width, height: canvasSize.height }}>
          {rows.length === 0 && (
            <p className="empty-graph-message">{tr(language, "从上方拖一个节点到画布开始新剧情。", "Drag a node from above onto the canvas to start a new story.")}</p>
          )}
          <svg className="node-link-layer" width={canvasSize.width} height={canvasSize.height} aria-hidden="true">
            <defs>
              <marker id="choice-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
                <path d="M0,0 L8,4 L0,8 Z" />
              </marker>
              <marker id="skip-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
                <path d="M0,0 L8,4 L0,8 Z" />
              </marker>
            </defs>
            {graphEdges.map((edge, index) => (
              <path
                key={`${edge.kind}-${edge.sourceIndex}-${edge.targetIndex}-${index}`}
                className={`graph-link ${edge.kind}`}
                d={graphEdgePath(edge, nodePositions, rows)}
                markerEnd={`url(#${edge.kind}-arrow)`}
              />
            ))}
            {connectionDrag && (
              <path
                className={`graph-link preview ${connectionDrag.kind}`}
                d={graphPreviewPath(connectionDrag, nodePositions, rows)}
                markerEnd="url(#skip-arrow)"
              />
            )}
            {paletteDrag && (
              <foreignObject className="palette-preview" x={paletteDrag.pointer.x - 70} y={paletteDrag.pointer.y - 18} width="140" height="36">
                <div className="palette-preview-chip">{storyNodeKindText(paletteDrag.kind)}</div>
              </foreignObject>
            )}
          </svg>

          {rows.map((row, rowIndex) => {
            const isSelected = selectedRow === rowIndex;
            const isOverLimit = lengthWarningRows.has(rowIndex);
            const hasPositionWarning = positionWarningRows.has(rowIndex);
            const position = getNodePosition(row, rowIndex, nodePositions);

            return (
              <article
                key={`${row.id || "node"}-${rowIndex}`}
                ref={bindNodeRef(rowIndex)}
                className={`story-node graph-node ${nodeKindClass(row)}${isSelected ? " selected" : ""}${isOverLimit ? " length-warning" : ""}${hasPositionWarning ? " position-warning" : ""}`}
                data-node-index={rowIndex}
                style={{ left: position.x, top: position.y }}
                onClick={() => onSelect(rowIndex)}
              >
                <div
                  className="story-node-head graph-node-drag-handle"
                  onPointerDown={(event) => {
                    if (!row.id) {
                      return;
                    }
                    event.preventDefault();
                    onSelect(rowIndex);
                    setDragNode({
                      rowId: row.id,
                      startClientX: event.clientX,
                      startClientY: event.clientY,
                      origin: position,
                    });
                  }}
                >
                  <span className="node-kind">{nodeTypeLabel(row, language)}</span>
                  <strong>#{row.id || rowIndex + 1}</strong>
                  <button
                    type="button"
                    title={tr(language, "删除节点", "Delete node")}
                    className="icon-button danger"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(rowIndex);
                    }}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>

                <NodeContentEditor row={row} rowIndex={rowIndex} characterLimit={characterLimit} isOverLimit={isOverLimit} language={language} onChange={onChange} />

                <NodeRelationPorts
                  row={row}
                  rowIndex={rowIndex}
                  language={language}
                  onClearLink={onClearLink}
                  onJumpToNode={onJumpToNode}
                  onStartConnection={(kind, event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelect(rowIndex);
                    setConnectionDrag({
                      kind,
                      sourceIndex: rowIndex,
                      pointer: clientPointToCanvas(event.nativeEvent, canvasRef.current),
                    });
                  }}
                />
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function NodeContentEditor({
  row,
  rowIndex,
  characterLimit,
  isOverLimit,
  language,
  onChange,
}: {
  row: StoryRow;
  rowIndex: number;
  characterLimit: number | null;
  isOverLimit: boolean;
  language: AppLanguage;
  onChange: (rowIndex: number, key: string, value: string) => void;
}) {
  if (row.sign === "END") {
    return <p className="node-empty-text">{tr(language, "结束节点", "End Node")}</p>;
  }

  if (row.sign === "$" || row.reward) {
    return (
      <label className="node-field">
        {tr(language, "奖励", "Reward")}
        <input value={row.reward ?? ""} onChange={(event) => onChange(rowIndex, "reward", event.target.value)} />
      </label>
    );
  }

  return (
    <div className="node-edit-grid">
      <label className="node-field node-content-field">
        {row.sign === "&" ? tr(language, "选项文本", "Choice Text") : tr(language, "正文", "Content")}
        <textarea
          value={row.content ?? ""}
          onKeyDown={handleTextareaKeyDown}
          onPaste={(event) => handleTextareaPaste(event, row.content ?? "", (value) => onChange(rowIndex, "content", value))}
          onChange={(event) => onChange(rowIndex, "content", event.target.value)}
        />
        <span className={isOverLimit ? "over-limit-count" : undefined}>
          {formatCharacterCount(row.content ?? "", characterLimit)}
        </span>
      </label>
      {row.sign !== "&" && (
        <div className="node-inline-fields">
          <label className="node-field">
            {tr(language, "角色", "Role")}
            <input value={row.role ?? ""} onChange={(event) => onChange(rowIndex, "role", event.target.value)} />
          </label>
          <label className="node-field">
            {tr(language, "人物ID", "Role ID")}
            <input value={row.roleID ?? ""} onChange={(event) => onChange(rowIndex, "roleID", event.target.value)} />
          </label>
          <div className="node-field">
            {tr(language, "位置", "Position")}
            <PositionSwitch value={row.boxPos ?? "l"} language={language} onFocus={() => undefined} onChange={(value) => onChange(rowIndex, "boxPos", value)} />
          </div>
        </div>
      )}
    </div>
  );
}

function NodeRelationPorts({
  row,
  rowIndex,
  language,
  onClearLink,
  onJumpToNode,
  onStartConnection,
}: {
  row: StoryRow;
  rowIndex: number;
  language: AppLanguage;
  onClearLink: (rowIndex: number, kind: GraphLinkKind) => void;
  onJumpToNode: (id: string) => void;
  onStartConnection: (kind: GraphLinkKind, event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="node-relation-panel">
      <div className="node-port-row">
        <button
          type="button"
          className="node-port skip"
          title={tr(language, "拖到目标节点：设置跳转并自动绑定父节点", "Drag to target node: set skip and bind the parent automatically")}
          onPointerDown={(event) => onStartConnection("skip", event)}
        >
          {tr(language, "拖出连线", "Drag Link")}
        </button>
      </div>
      <div className="node-link-row">
        {row.parent_id && (
          <span className="link-chip parent readonly">
            <button type="button" onClick={() => onJumpToNode(row.parent_id)}>
              {tr(language, `父 ${row.parent_id}`, `Parent ${row.parent_id}`)}
            </button>
          </span>
        )}
        {row.skip && (
          <span className="link-chip skip">
            <button type="button" onClick={() => onJumpToNode(row.skip)}>
              {tr(language, `跳转 ${row.skip}`, `Skip ${row.skip}`)}
              <ArrowRight size={13} aria-hidden="true" />
            </button>
            <button type="button" title={tr(language, "清空跳转连线", "Clear skip link")} className="chip-clear" onClick={() => onClearLink(rowIndex, "skip")}>
              ×
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

function EditableCell({
  column,
  row,
  rowIndex,
  onFocus,
  onChange,
  characterLimit,
  isOverLimit,
  language,
}: {
  column: ColumnTemplate;
  row: StoryRow;
  rowIndex: number;
  onFocus: (rowIndex: number) => void;
  onChange: (rowIndex: number, key: string, value: string) => void;
  characterLimit: number | null;
  isOverLimit: boolean;
  language: AppLanguage;
}) {
  if (!isCellNeeded(row, column.key)) {
    return <span className="not-needed">-</span>;
  }

  if (column.key === "boxPos") {
    return (
      <PositionSwitch
        value={row[column.key] ?? "l"}
        language={language}
        onFocus={() => onFocus(rowIndex)}
        onChange={(value) => onChange(rowIndex, column.key, value)}
      />
    );
  }

  if (column.key === "content") {
    return (
      <label className="content-editor">
        <textarea
          value={row[column.key] ?? ""}
          onKeyDown={handleTextareaKeyDown}
          onPaste={(event) => handleTextareaPaste(event, row[column.key] ?? "", (value) => onChange(rowIndex, column.key, value))}
          onFocus={() => onFocus(rowIndex)}
          onChange={(event) => onChange(rowIndex, column.key, event.target.value)}
        />
        <span className={isOverLimit ? "over-limit-count" : undefined}>
          {formatCharacterCount(row[column.key] ?? "", characterLimit)}
        </span>
      </label>
    );
  }

  return <input value={row[column.key] ?? ""} onFocus={() => onFocus(rowIndex)} onChange={(event) => onChange(rowIndex, column.key, event.target.value)} />;
}

function PositionSwitch({ value, language, onFocus, onChange }: { value: string; language: AppLanguage; onFocus: () => void; onChange: (value: string) => void }) {
  const checked = value === "r";
  return (
    <label className="switch-control">
      <input
        type="checkbox"
        checked={checked}
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.checked ? "r" : "l")}
      />
      <span className="switch-track" aria-hidden="true" />
      <strong>{checked ? tr(language, "右", "R") : tr(language, "左", "L")}</strong>
    </label>
  );
}

function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key === "Enter" && event.ctrlKey) {
    // Electron does not natively insert a newline on Ctrl+Enter like a browser does,
    // so we insert it explicitly. execCommand triggers React's onChange correctly.
    event.preventDefault();
    document.execCommand("insertText", false, "\n");
    return;
  }
  if (shouldBlockTextareaNewline(event.key, event.altKey, event.ctrlKey)) {
    event.preventDefault();
  }
}

function handleTextareaPaste(event: ClipboardEvent<HTMLTextAreaElement>, currentValue: string, commit: (value: string) => void) {
  const pasted = event.clipboardData.getData("text");
  const cleaned = stripPastedNewlines(pasted);
  if (cleaned === pasted) {
    return;
  }

  event.preventDefault();
  const target = event.currentTarget;
  const selectionStart = target.selectionStart;
  const selectionEnd = target.selectionEnd;
  const nextValue = `${currentValue.slice(0, selectionStart)}${cleaned}${currentValue.slice(selectionEnd)}`;
  commit(nextValue);

  window.requestAnimationFrame(() => {
    target.selectionStart = selectionStart + cleaned.length;
    target.selectionEnd = selectionStart + cleaned.length;
  });
}

async function readClipboardText(): Promise<string> {
  if (window.storyEditorClipboard) {
    return window.storyEditorClipboard.readText();
  }

  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText();
  }

  throw new Error("Clipboard reading is not supported in this environment");
}

function focusEditableElement(container: HTMLElement | undefined): boolean {
  if (!container) {
    return false;
  }

  window.focus();
  const editable = container.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea, input:not([type="checkbox"])');
  if (!editable) {
    return false;
  }

  window.requestAnimationFrame(() => {
    editable.focus({ preventScroll: true });
    if (editable instanceof HTMLTextAreaElement || editable.type === "text") {
      const end = editable.value.length;
      editable.setSelectionRange(end, end);
    }
  });
  return true;
}

function isEditableElement(element: Element | null): boolean {
  if (!element) {
    return false;
  }
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }
  if (element instanceof HTMLInputElement) {
    return element.type !== "checkbox";
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

function isCellNeeded(row: StoryRow, key: string): boolean {
  if (row.sign === "END") {
    return false;
  }
  if (row.sign === "&") {
    return key === "content";
  }
  if (row.sign === "$" || row.reward) {
    return key === "reward";
  }
  return key !== "reward";
}

function rowClassName(isSelected: boolean, hasLengthWarning: boolean, hasPositionWarning: boolean): string {
  return [
    isSelected ? "selected" : "",
    hasLengthWarning ? "length-warning" : "",
    hasPositionWarning ? "position-warning" : "",
  ].filter(Boolean).join(" ");
}

function nodeKindClass(row: StoryRow): string {
  if (row.sign === "END") {
    return "end-node";
  }
  if (row.sign === "&") {
    return "choice-node";
  }
  if (row.sign === "$" || row.reward) {
    return "reward-node";
  }
  return "dialogue-node";
}

function buildGraphEdges(rows: StoryRow[]): GraphEdge[] {
  const idToIndex = new Map<string, number>();
  rows.forEach((row, index) => {
    if (row.id) {
      idToIndex.set(row.id, index);
    }
  });
  const edges: GraphEdge[] = [];

  rows.forEach((row, rowIndex) => {
    const skipIndex = row.skip ? idToIndex.get(row.skip) : undefined;
    if (skipIndex !== undefined) {
      if (rows[skipIndex]?.sign === "&") {
        getChoiceGroupIndexes(rows, skipIndex)
          .filter((optionIndex) => rows[optionIndex]?.parent_id === row.id)
          .forEach((optionIndex) => {
            edges.push({ kind: "choice", sourceIndex: rowIndex, targetIndex: optionIndex, label: rows[optionIndex]?.content || "选项" });
          });
        return;
      }

      edges.push({ kind: "skip", sourceIndex: rowIndex, targetIndex: skipIndex, label: row.sign === "&" ? "分支" : "跳转" });
    }
  });

  return edges;
}

function createDetachedStoryNode(template: StoryTemplate, rows: StoryRow[], kind: StoryNodeKind): StoryRow {
  const row = createEmptyRow(template);
  row.id = nextNumericRowId(rows);
  row.isBegin = rows.length === 0 ? "TRUE" : "";
  row.sign = kind === "reward" ? "$" : kind === "end" ? "END" : kind === "choice" ? "&" : "#";
  row.parent_id = "";
  row.skip = "";

  if (kind === "choice") {
    row.content = "新选项";
  } else if (kind === "dialogue") {
    row.boxPos = "l";
  } else if (kind === "reward") {
    row.reward = "attr:1:0";
  }

  return row;
}

function nextNumericRowId(rows: StoryRow[]): string {
  const maxId = rows.reduce((max, row) => {
    const numericId = Number(row.id);
    return Number.isFinite(numericId) ? Math.max(max, numericId) : max;
  }, 0);
  return String(maxId + 1);
}

function storyNodeKindText(kind: StoryNodeKind, language: AppLanguage = "zh"): string {
  if (kind === "choice") {
    return tr(language, "添加选项", "Add Choice");
  }
  if (kind === "reward") {
    return tr(language, "添加奖励", "Add Reward");
  }
  if (kind === "end") {
    return tr(language, "添加结束", "Add End");
  }
  return tr(language, "添加对话", "Add Dialogue");
}

function getChoiceGroupIndexes(rows: StoryRow[], optionIndex: number): number[] {
  const option = rows[optionIndex];
  if (!option || option.sign !== "&") {
    return [];
  }

  if (!option.parent_id) {
    return [optionIndex];
  }

  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.sign === "&" && row.parent_id === option.parent_id)
    .map(({ index }) => index);
}

function firstChoiceIndex(rows: StoryRow[], indexes: number[]): number {
  return [...indexes].sort((left, right) => {
    const leftId = Number(rows[left]?.id);
    const rightId = Number(rows[right]?.id);
    if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
      return leftId - rightId;
    }
    return left - right;
  })[0];
}

function getNodePosition(row: StoryRow, rowIndex: number, positions: Record<string, NodePosition>): NodePosition {
  if (row.id && positions[row.id]) {
    return positions[row.id];
  }
  return defaultNodePosition(rowIndex);
}

function defaultNodePosition(rowIndex: number): NodePosition {
  const column = rowIndex % 3;
  const row = Math.floor(rowIndex / 3);
  return {
    x: GRAPH_PADDING + column * (GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP),
    y: GRAPH_PADDING + row * (GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP),
  };
}

function reconcileNodePositions(rows: StoryRow[], current: Record<string, NodePosition>): Record<string, NodePosition> {
  const next: Record<string, NodePosition> = {};
  rows.forEach((row, rowIndex) => {
    if (!row.id) {
      return;
    }
    next[row.id] = current[row.id] ?? defaultNodePosition(rowIndex);
  });
  return next;
}

function getGraphCanvasSize(rows: StoryRow[], positions: Record<string, NodePosition>): { width: number; height: number } {
  if (rows.length === 0) {
    return { width: 800, height: 520 };
  }

  return rows.reduce(
    (size, row, rowIndex) => {
      const position = getNodePosition(row, rowIndex, positions);
      return {
        width: Math.max(size.width, position.x + GRAPH_NODE_WIDTH + GRAPH_PADDING),
        height: Math.max(size.height, position.y + GRAPH_NODE_HEIGHT + GRAPH_PADDING),
      };
    },
    { width: 900, height: 560 },
  );
}

function graphEdgePath(edge: GraphEdge, positions: Record<string, NodePosition>, rows: StoryRow[]): string {
  const source = graphAnchor(edge.sourceIndex, "out", positions, rows);
  const target = graphAnchor(edge.targetIndex, "in", positions, rows);
  return bezierPath(source, target);
}

function graphPreviewPath(drag: ConnectionDrag, positions: Record<string, NodePosition>, rows: StoryRow[]): string {
  const source = graphAnchor(drag.sourceIndex, "out", positions, rows);
  return bezierPath(source, drag.pointer);
}

function graphAnchor(rowIndex: number, side: "in" | "out", positions: Record<string, NodePosition>, rows: StoryRow[]): NodePosition {
  const position = getNodePosition(rows[rowIndex] ?? {}, rowIndex, positions);
  return side === "out"
    ? { x: position.x + GRAPH_NODE_WIDTH, y: position.y + 54 }
    : { x: position.x, y: position.y + 54 };
}

function bezierPath(source: NodePosition, target: NodePosition): string {
  const distance = Math.max(80, Math.abs(target.x - source.x) * 0.45);
  const sourceControlX = source.x + distance;
  const targetControlX = target.x - distance;
  return `M ${source.x} ${source.y} C ${sourceControlX} ${source.y}, ${targetControlX} ${target.y}, ${target.x} ${target.y}`;
}

function clientPointToCanvas(event: PointerEvent, canvas: HTMLDivElement | null): NodePosition {
  if (!canvas) {
    return { x: event.clientX, y: event.clientY };
  }
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left + canvas.scrollLeft,
    y: event.clientY - rect.top + canvas.scrollTop,
  };
}

function loadNodePositions(sourceName: string): Record<string, NodePosition> {
  try {
    const raw = window.localStorage.getItem(nodePositionStorageKey(sourceName));
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, NodePosition>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => Number.isFinite(value?.x) && Number.isFinite(value?.y)),
    );
  } catch {
    return {};
  }
}

function saveNodePositions(sourceName: string, positions: Record<string, NodePosition>) {
  window.localStorage.setItem(nodePositionStorageKey(sourceName), JSON.stringify(positions));
}

function nodePositionStorageKey(sourceName: string): string {
  return `${NODE_POSITION_STORAGE_PREFIX}.${sourceName || "story.csv"}`;
}

function getChoiceContext(rows: StoryRow[], selectedRow: number): ChoiceContext | null {
  if (rows.length === 0) {
    return null;
  }

  const safeIndex = Math.max(0, Math.min(selectedRow, rows.length - 1));
  const selected = rows[safeIndex];
  let parentIndex = -1;

  if (selected.sign === "&") {
    parentIndex = rows.findIndex((row) => row.id === selected.parent_id);
  } else {
    const selectedParentIndex = rows.findIndex((row) => row.id === selected.parent_id);
    if (rows[selectedParentIndex]?.sign === "&") {
      parentIndex = rows.findIndex((row) => row.id === rows[selectedParentIndex].parent_id);
    } else if (rows.some((row) => row.sign === "&" && row.parent_id === selected.id)) {
      parentIndex = safeIndex;
    }
  }

  if (parentIndex < 0) {
    return null;
  }

  const parent = rows[parentIndex];
  const choices = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.sign === "&" && row.parent_id === parent.id)
    .map(({ row, index }) => {
      const dialogueIndex = rows.findIndex((candidate) => candidate.id === row.skip);
      return {
        option: row,
        optionIndex: index,
        dialogue: dialogueIndex >= 0 ? rows[dialogueIndex] : undefined,
        dialogueIndex,
      };
    });

  return choices.length > 0 ? { parentIndex, parent, choices } : null;
}

function getDialogueConfigColumns(template: StoryTemplate): ColumnTemplate[] {
  const excluded = new Set(["id", "isBegin", "sign", "parent_id", "skip", "failSkip", "role", "boxPos", "content", "reward"]);
  return template.columns.filter((column) => !excluded.has(column.key));
}

function nextColumnKey(template: StoryTemplate): string {
  let index = template.columns.length + 1;
  let key = `field_${index}`;
  const used = new Set(template.columns.map((column) => column.key));
  while (used.has(key)) {
    index += 1;
    key = `field_${index}`;
  }
  return key;
}

function formatCharacterCount(value: string, limit: number | null): string {
  const count = countCharacters(value);
  return limit === null ? String(count) : `${count} / ${limit}`;
}

function tr(language: AppLanguage, zh: string, en: string): string {
  return language === "en" ? en : zh;
}

function countCharacters(value: string): number {
  return Array.from(value).length;
}

function makeDraftSnapshot(input: { sourceName: string; template: StoryTemplate; rows: StoryRow[]; selectedRow: number }): string {
  return JSON.stringify(input);
}

function isRetryableAiError(message: string): boolean {
  const normalized = message.toLowerCase();
  const permanentMarkers = [
    "api key",
    "鉴权失败",
    "invalid ai provider",
    "invalid ai base url",
    "request is incomplete",
    "未找到模型配置",
    "未知场景",
    "不在当前场景",
    "无效的目标场景",
    "无效的结局判定",
    "invalid json",
  ];
  if (permanentMarkers.some((marker) => normalized.includes(marker))) {
    return false;
  }
  return [
    "只返回推理内容",
    "没有返回结构化正文",
    "no structured output",
    "timed out",
    "超时",
    "429",
    "限流",
    "暂时不可用",
    "fetch failed",
    "network",
    "econnreset",
    "socket",
  ].some((marker) => normalized.includes(marker));
}

function isTransientAiTransportError(message: string): boolean {
  const normalized = message.toLowerCase();
  return [
    "429",
    "限流",
    "（500）",
    "（502）",
    "（503）",
    "（504）",
    "暂时不可用",
    "fetch failed",
    "network",
    "econnreset",
    "socket",
  ].some((marker) => normalized.includes(marker));
}

function isProviderOriginError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("cloudflare")
    && (normalized.includes("origin") || normalized.includes("源站") || normalized.includes("host error"));
}

function buildCorrectionInput(originalInput: string, invalidOutput: unknown, validationError: string): string {
  let parsedInput: unknown = originalInput;
  try {
    parsedInput = JSON.parse(originalInput);
  } catch {
    // Keep non-JSON provider input as text.
  }
  return JSON.stringify({
    originalInput: parsedInput,
    correction: {
      validationError,
      invalidOutput,
      instruction: "修正上次输出中违反本地规则的字段。保持原任务、既有事实和 JSON Schema 不变，只返回一份完整且合法的新结果；不要解释错误，不要输出思维过程。",
    },
  });
}


function formatSavedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
