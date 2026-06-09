import { createEmptyRow } from "../defaultTemplate";
import type { ColumnTemplate, StoryRow, StoryTemplate } from "../types";

export type StoryNodeKind = "dialogue" | "reward" | "choice" | "end";
export type StoryEditorLanguage = "zh" | "en";

const SYSTEM_KEYS = new Set(["id", "isBegin", "sign", "parent_id", "skip", "failSkip"]);
const OPTIONAL_DIALOGUE_KEYS = ["boxPos"];
const OPTIONAL_EDITOR_KEYS = ["bgmPath", "backPic", "mp3Path"];

export type InsertStoryNodeResult = {
  rows: StoryRow[];
  insertedIndex: number;
};

export function getEditorColumns(template: StoryTemplate, rows: StoryRow[]): ColumnTemplate[] {
  return template.columns.filter((column) => {
    if (SYSTEM_KEYS.has(column.key)) {
      return false;
    }
    if (column.key === "content") {
      return true;
    }
    if (column.key === "role") {
      return true;
    }
    if (OPTIONAL_DIALOGUE_KEYS.includes(column.key)) {
      return rows.length === 0 || rows.some((row) => row.sign !== "&" && !isRewardRow(row) && hasValue(row[column.key]));
    }
    if (column.key === "reward") {
      return rows.some((row) => isRewardRow(row));
    }
    if (OPTIONAL_EDITOR_KEYS.includes(column.key)) {
      return rows.some((row) => hasValue(row[column.key]));
    }
    return column.isLang || rows.some((row) => hasValue(row[column.key]));
  });
}

export function insertStoryNode(
  template: StoryTemplate,
  rows: StoryRow[],
  selectedRow: number,
  kind: StoryNodeKind,
): InsertStoryNodeResult {
  if (kind === "choice") {
    return insertChoiceBranch(template, rows, selectedRow);
  }

  if (rows.length === 0) {
    return {
      rows: [createNodeRow(template, rows, kind, undefined, "", true)],
      insertedIndex: 0,
    };
  }

  const anchorIndex = resolveAnchorIndex(rows, selectedRow);
  const anchor = rows[anchorIndex];
  const nextId = anchor.skip || rows[anchorIndex + 1]?.id || "";
  const node = createNodeRow(template, rows, kind, anchor, nextId, false);
  const updatedRows = rows.map((row, rowIndex) =>
    rowIndex === anchorIndex && row.sign !== "END" ? { ...row, skip: node.id } : row,
  );

  updatedRows.splice(anchorIndex + 1, 0, node);

  return {
    rows: ensureFirstBeginFlag(updatedRows),
    insertedIndex: anchorIndex + 1,
  };
}

export function deleteStoryNode(rows: StoryRow[], rowIndex: number): StoryRow[] {
  const deleted = rows[rowIndex];
  if (!deleted) {
    return rows;
  }

  const previousIndex = findPreviousLinkIndex(rows, deleted.id, rowIndex);
  const fallbackNextId = deleted.skip || rows[rowIndex + 1]?.id || "";
  const previousId = previousIndex >= 0 ? rows[previousIndex].id : "";

  return ensureFirstBeginFlag(rows
    .filter((_, index) => index !== rowIndex)
    .map((row, index) => {
      const originalIndex = index >= rowIndex ? index + 1 : index;
      let next = row;
      if (originalIndex === previousIndex && previousId) {
        next = { ...next, skip: fallbackNextId };
      }
      if (deleted.id && row.parent_id === deleted.id) {
        next = { ...next, parent_id: previousId };
      }
      return next;
    }));
}

export function nodeTypeLabel(row: StoryRow, language: StoryEditorLanguage = "zh"): string {
  if (row.sign === "END") {
    return language === "en" ? "End" : "结束";
  }
  if (row.sign === "&") {
    return language === "en" ? "Choice" : "选项";
  }
  if (isRewardRow(row)) {
    return language === "en" ? "Reward" : "奖励";
  }
  return language === "en" ? "Dialogue" : "对话";
}

export function ensureFirstBeginFlag(rows: StoryRow[]): StoryRow[] {
  if (rows.length === 0) {
    return rows;
  }
  if (rows[0].isBegin === "TRUE") {
    return rows;
  }
  return rows.map((row, index) => (index === 0 ? { ...row, isBegin: "TRUE" } : row));
}

function insertChoiceBranch(template: StoryTemplate, rows: StoryRow[], selectedRow: number): InsertStoryNodeResult {
  if (rows.length === 0) {
    const optionId = nextNumericId(rows);
    const dialogueId = nextNumericId(rows, 2);
    const option = createChoiceRow(template, optionId, "", "新选项", dialogueId);
    const dialogue = createDialogueRow(template, dialogueId, optionId, "", undefined, true);
    return { rows: ensureFirstBeginFlag([option, dialogue]), insertedIndex: 0 };
  }

  const parentIndex = resolveChoiceParentIndex(rows, selectedRow);
  const parent = rows[parentIndex];
  const existingOptions = rows.filter((row) => row.sign === "&" && row.parent_id === parent.id);
  const groupRootId = existingOptions[0]?.id || "";
  const oldLinearNextId = parent.skip && !existingOptions.some((option) => option.id === parent.skip) ? parent.skip : "";
  const mergeTargetId = findBranchMergeTarget(rows, existingOptions) || oldLinearNextId;
  const optionId = nextNumericId(rows);
  const dialogueId = nextNumericId(rows, 2);
  const option = createChoiceRow(template, optionId, parent.id, "新选项", dialogueId);
  const dialogue = createDialogueRow(template, dialogueId, groupRootId || optionId, mergeTargetId, parent, false);
  const insertionIndex = resolveChoiceInsertionIndex(rows, parentIndex, existingOptions);
  const updatedRows = rows.map((row, rowIndex) => {
    if (rowIndex === parentIndex) {
      return { ...row, skip: groupRootId || optionId };
    }
    return row;
  });

  updatedRows.splice(insertionIndex, 0, option, dialogue);

  return {
    rows: ensureFirstBeginFlag(updatedRows),
    insertedIndex: insertionIndex,
  };
}

function createNodeRow(
  template: StoryTemplate,
  rows: StoryRow[],
  kind: StoryNodeKind,
  previous: StoryRow | undefined,
  nextId: string,
  isBegin: boolean,
): StoryRow {
  const row = createEmptyRow(template);
  row.id = nextNumericId(rows);
  row.isBegin = isBegin ? "TRUE" : "";
  row.sign = kind === "reward" ? "$" : kind === "end" ? "END" : "#";
  row.parent_id = previous?.id ?? "";
  row.skip = nextId;

  if (kind === "dialogue") {
    row.role = previous?.role ?? "";
    row.roleID = previous?.roleID ?? "";
    row.boxPos = previous?.boxPos ?? "l";
    row.content = "";
  } else if (kind === "reward") {
    row.reward = "attr:1:0";
  }

  return row;
}

function createChoiceRow(template: StoryTemplate, id: string, parentId: string, content: string, skip: string): StoryRow {
  const row = createEmptyRow(template);
  row.id = id;
  row.sign = "&";
  row.parent_id = parentId;
  row.content = content;
  row.skip = skip;
  return row;
}

function createDialogueRow(
  template: StoryTemplate,
  id: string,
  parentId: string,
  skip: string,
  previous: StoryRow | undefined,
  isBegin: boolean,
): StoryRow {
  const row = createEmptyRow(template);
  row.id = id;
  row.isBegin = isBegin ? "TRUE" : "";
  row.sign = "#";
  row.parent_id = parentId;
  row.skip = skip;
  row.role = previous?.role ?? "";
  row.roleID = previous?.roleID ?? "";
  row.boxPos = previous?.boxPos ?? "l";
  row.content = "";
  return row;
}

function resolveAnchorIndex(rows: StoryRow[], selectedRow: number): number {
  const safeIndex = Math.max(0, Math.min(selectedRow, rows.length - 1));
  if (rows[safeIndex]?.sign === "END" && safeIndex > 0) {
    return safeIndex - 1;
  }
  return safeIndex;
}

function findPreviousLinkIndex(rows: StoryRow[], deletedId: string, rowIndex: number): number {
  if (deletedId) {
    const linkedIndex = rows.findIndex((row, index) => index !== rowIndex && row.skip === deletedId);
    if (linkedIndex >= 0) {
      return linkedIndex;
    }
  }
  return rowIndex - 1;
}

function resolveChoiceParentIndex(rows: StoryRow[], selectedRow: number): number {
  const safeIndex = Math.max(0, Math.min(selectedRow, rows.length - 1));
  const selected = rows[safeIndex];
  if (selected.sign === "&") {
    const parentIndex = rows.findIndex((row) => row.id === selected.parent_id);
    return parentIndex >= 0 ? parentIndex : safeIndex;
  }

  const selectedParent = rows.find((row) => row.id === selected.parent_id);
  if (selectedParent?.sign === "&") {
    const branchParentIndex = rows.findIndex((row) => row.id === selectedParent.parent_id);
    return branchParentIndex >= 0 ? branchParentIndex : safeIndex;
  }

  if (selected.sign === "END" && safeIndex > 0) {
    return resolveChoiceParentIndex(rows, safeIndex - 1);
  }

  return safeIndex;
}

function resolveChoiceInsertionIndex(rows: StoryRow[], parentIndex: number, existingOptions: StoryRow[]): number {
  const relatedIndexes = [parentIndex];
  existingOptions.forEach((option) => {
    const optionIndex = rows.findIndex((row) => row.id === option.id);
    const dialogueIndex = rows.findIndex((row) => row.id === option.skip);
    if (optionIndex >= 0) {
      relatedIndexes.push(optionIndex);
    }
    if (dialogueIndex >= 0) {
      relatedIndexes.push(dialogueIndex);
    }
  });
  return Math.max(...relatedIndexes) + 1;
}

function findBranchMergeTarget(rows: StoryRow[], existingOptions: StoryRow[]): string {
  const targets = existingOptions
    .map((option) => rows.find((row) => row.id === option.skip)?.skip)
    .filter((skip): skip is string => Boolean(skip));
  if (targets.length === 0) {
    return "";
  }
  return targets.every((target) => target === targets[0]) ? targets[0] : "";
}

function nextNumericId(rows: StoryRow[], offset = 1): string {
  const maxId = rows.reduce((max, row) => {
    const numericId = Number(row.id);
    return Number.isFinite(numericId) ? Math.max(max, numericId) : max;
  }, 0);
  return String(maxId + offset);
}

function isRewardRow(row: StoryRow): boolean {
  return row.sign === "$" || hasValue(row.reward);
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}
