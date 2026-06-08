import { createEmptyRow } from "../defaultTemplate";
import type { StoryRow, StoryTemplate } from "../types";
import { ensureFirstBeginFlag } from "./rowActions";

export type ScriptClipboardEntry = {
  scene: string;
  role: string;
  content: string;
};

export type InsertScriptRowsResult = {
  rows: StoryRow[];
  insertedIndex: number;
  insertedCount: number;
  narratorCount: number;
  skippedCount: number;
};

export function insertScriptRowsFromClipboard(
  template: StoryTemplate,
  rows: StoryRow[],
  selectedRow: number,
  clipboardText: string,
): InsertScriptRowsResult {
  const parsed = parseScriptClipboard(clipboardText);
  if (parsed.entries.length === 0) {
    return {
      rows,
      insertedIndex: Math.max(0, Math.min(selectedRow, rows.length - 1)),
      insertedCount: 0,
      narratorCount: 0,
      skippedCount: parsed.skippedCount,
    };
  }

  const anchorIndex = resolveAnchorIndex(rows, selectedRow);
  const anchor = rows[anchorIndex];
  const oldNextId = anchor?.skip || rows[anchorIndex + 1]?.id || "";
  const startId = nextNumericId(rows);
  const insertedRows = parsed.entries.map((entry, index) => {
    const row = createEmptyRow(template);
    const id = String(startId + index);

    row.id = id;
    row.isBegin = rows.length === 0 && index === 0 ? "TRUE" : "";
    row.sign = "#";
    row.parent_id = index === 0 ? anchor?.id ?? "" : String(startId + index - 1);
    row.skip = index === parsed.entries.length - 1 ? oldNextId : String(startId + index + 1);
    row.backPic = entry.scene;
    row.role = isNarratorRole(entry.role) ? "" : entry.role;
    row.boxPos = anchor?.boxPos || "l";
    row.content = entry.content;

    return row;
  });

  if (rows.length === 0) {
    return {
      rows: ensureFirstBeginFlag(insertedRows),
      insertedIndex: 0,
      insertedCount: insertedRows.length,
      narratorCount: parsed.entries.filter((entry) => isNarratorRole(entry.role)).length,
      skippedCount: parsed.skippedCount,
    };
  }

  const insertionIndex = anchorIndex + 1;
  const updatedRows = rows.map((row, index) =>
    index === anchorIndex && row.sign !== "END" ? { ...row, skip: insertedRows[0]?.id ?? row.skip } : row,
  );
  updatedRows.splice(insertionIndex, 0, ...insertedRows);

  return {
    rows: ensureFirstBeginFlag(updatedRows),
    insertedIndex: insertionIndex,
    insertedCount: insertedRows.length,
    narratorCount: parsed.entries.filter((entry) => isNarratorRole(entry.role)).length,
    skippedCount: parsed.skippedCount,
  };
}

export function parseScriptClipboard(text: string): { entries: ScriptClipboardEntry[]; skippedCount: number } {
  const matrix = parseTabDelimited(text);
  const dataRows = hasScriptHeader(matrix[0]) ? matrix.slice(1) : matrix;
  let skippedCount = 0;

  const entries = dataRows.flatMap((row) => {
    const entry = {
      scene: cleanCell(row[0]),
      role: cleanCell(row[1]),
      content: cleanCell(row[2]),
    };

    if (!entry.scene && !entry.role && !entry.content) {
      skippedCount += 1;
      return [];
    }

    if (!entry.content) {
      skippedCount += 1;
      return [];
    }

    return [entry];
  });

  return { entries, skippedCount };
}

function parseTabDelimited(text: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === "\t") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char === "\r") {
      if (next === "\n") {
        continue;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  rows.push(row);

  const endedWithLineBreak = /\r?\n$/.test(normalized);
  if (endedWithLineBreak && rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === "") {
    rows.pop();
  }

  return rows;
}

function hasScriptHeader(row: string[] | undefined): boolean {
  if (!row) {
    return false;
  }

  const scene = cleanCell(row[0]);
  const role = cleanCell(row[1]);
  const content = cleanCell(row[2]);
  return scene.includes("场景") && role.includes("角色") && (content.includes("正文") || content.includes("内容"));
}

function cleanCell(value: string | undefined): string {
  return String(value ?? "").trim();
}

function isNarratorRole(value: string): boolean {
  return value.trim().replace(/[：:]\s*$/, "") === "旁白";
}

function resolveAnchorIndex(rows: StoryRow[], selectedRow: number): number {
  if (rows.length === 0) {
    return 0;
  }

  const safeIndex = Math.max(0, Math.min(selectedRow, rows.length - 1));
  return rows[safeIndex]?.sign === "END" && safeIndex > 0 ? safeIndex - 1 : safeIndex;
}

function nextNumericId(rows: StoryRow[]): number {
  return (
    rows.reduce((max, row) => {
      const numericId = Number(row.id);
      return Number.isFinite(numericId) ? Math.max(max, numericId) : max;
    }, 0) + 1
  );
}
