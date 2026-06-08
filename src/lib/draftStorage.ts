import type { StoryRow, StoryTemplate } from "../types";

const DRAFT_STORAGE_KEY = "story-editor.draft.v1";

export type StoryDraft = {
  version: 1;
  sourceName: string;
  template: StoryTemplate;
  rows: StoryRow[];
  selectedRow: number;
  savedAt: string;
};

export type DraftInput = Omit<StoryDraft, "version" | "savedAt">;

export function loadDraft(): StoryDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoryDraft>;
    if (parsed.version !== 1 || !parsed.template || !Array.isArray(parsed.rows)) {
      return null;
    }
    return {
      version: 1,
      sourceName: parsed.sourceName || "story.csv",
      template: parsed.template,
      rows: parsed.rows,
      selectedRow: Number.isFinite(parsed.selectedRow) ? Number(parsed.selectedRow) : 0,
      savedAt: parsed.savedAt || new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveDraft(input: DraftInput): StoryDraft {
  const draft: StoryDraft = {
    ...input,
    version: 1,
    selectedRow: Math.max(0, Math.min(input.selectedRow, Math.max(0, input.rows.length - 1))),
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  return draft;
}
