import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTemplate } from "../defaultTemplate";
import { loadDraft, saveDraft } from "./draftStorage";

describe("draft storage", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        clear: () => store.clear(),
        getItem: (key: string) => store.get(key) ?? null,
        removeItem: (key: string) => store.delete(key),
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T08:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves and restores the active story draft", () => {
    const saved = saveDraft({
      sourceName: "story.csv",
      template: defaultTemplate,
      rows: [{ id: "1", sign: "#", content: "hello" }],
      selectedRow: 8,
    });
    const loaded = loadDraft();

    expect(saved.savedAt).toBe("2026-06-05T08:00:00.000Z");
    expect(loaded?.sourceName).toBe("story.csv");
    expect(loaded?.rows[0].content).toBe("hello");
    expect(loaded?.selectedRow).toBe(0);
    expect(loaded?.template.columns[0].key).toBe("id");
  });

  it("ignores invalid saved drafts", () => {
    localStorage.setItem("story-editor.draft.v1", JSON.stringify({ version: 99 }));

    expect(loadDraft()).toBeNull();
  });
});
