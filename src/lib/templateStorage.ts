import type { StoryTemplate } from "../types";

const STORAGE_KEY = "story-editor.template.v1";

export function loadSavedTemplate(): StoryTemplate | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoryTemplate) : null;
  } catch {
    return null;
  }
}

export function saveTemplate(template: StoryTemplate) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(template));
}
