import { defaultTemplate } from "../defaultTemplate";
import type { ColumnTemplate, ParsedStory, StoryRow, StoryTemplate, ValidationIssue } from "../types";
import { parseCsv, stringifyCsv } from "./csv";

export function importCsvText(text: string, sourceName = "导入剧情表"): ParsedStory {
  return importMatrix(parseCsv(text), sourceName);
}

export function importMatrix(matrix: string[][], sourceName = "导入剧情表"): ParsedStory {
  if (matrix.length < 4) {
    return {
      template: { ...defaultTemplate, name: sourceName },
      rows: [],
    };
  }

  const [keys, valueTypes, labels, channels] = matrix;
  const columns = keys.map((rawKey, index) => {
    const key = String(rawKey ?? "").trim() || `field_${index + 1}`;
    const label = String(labels[index] ?? key);
    return {
      key,
      valueType: String(valueTypes[index] ?? "string") || "string",
      label,
      channel: String(channels[index] ?? "c") || "c",
      isLang: label.includes("#Lang"),
    };
  });

  const rows = matrix.slice(4).filter(hasAnyValue).map((row) => {
    const record: StoryRow = {};
    columns.forEach((column, index) => {
      record[column.key] = String(row[index] ?? "");
    });
    return record;
  });

  return {
    template: {
      id: `imported-${Date.now()}`,
      name: sourceName,
      columns,
    },
    rows,
  };
}

export function buildMatrix(template: StoryTemplate, rows: StoryRow[]): string[][] {
  const columns = template.columns;
  return [
    columns.map((column) => column.key),
    columns.map((column) => column.valueType),
    columns.map((column) => column.label),
    columns.map((column) => column.channel),
    ...rows.map((row) => columns.map((column) => row[column.key] ?? "")),
  ];
}

export function exportCsvText(template: StoryTemplate, rows: StoryRow[]): string {
  return stringifyCsv(buildMatrix(template, rows), true);
}

export function normalizeRows(template: StoryTemplate, rows: StoryRow[]): StoryRow[] {
  return rows.map((row) => {
    const next: StoryRow = {};
    template.columns.forEach((column) => {
      next[column.key] = row[column.key] ?? "";
    });
    return next;
  });
}

export function updateColumnKey(rows: StoryRow[], oldKey: string, newKey: string): StoryRow[] {
  return rows.map((row) => {
    const next = { ...row };
    next[newKey] = row[oldKey] ?? "";
    if (oldKey !== newKey) {
      delete next[oldKey];
    }
    return next;
  });
}

export function removeColumnFromRows(rows: StoryRow[], key: string): StoryRow[] {
  return rows.map((row) => {
    const next = { ...row };
    delete next[key];
    return next;
  });
}

export function validateStory(template: StoryTemplate, rows: StoryRow[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const idColumn = findColumn(template, "id");
  const idCounts = new Map<string, number[]>();
  const idSet = new Set<string>();

  rows.forEach((row, rowIndex) => {
    const id = valueOf(row, idColumn);
    if (!id) {
      issues.push({ level: "error", rowIndex, columnKey: "id", message: "节点 ID 为空" });
      return;
    }
    idSet.add(id);
    idCounts.set(id, [...(idCounts.get(id) ?? []), rowIndex]);
  });

  idCounts.forEach((indexes, id) => {
    if (indexes.length > 1) {
      indexes.forEach((rowIndex) => {
        issues.push({ level: "error", rowIndex, columnKey: "id", message: `节点 ID 重复：${id}` });
      });
    }
  });

  const endRows = rows.filter((row) => valueOf(row, findColumn(template, "sign")) === "END");
  if (rows.length > 0 && endRows.length === 0) {
    issues.push({ level: "warning", rowIndex: -1, columnKey: "sign", message: "未找到 END 结束节点" });
  }

  rows.forEach((row, rowIndex) => {
    validateRowReferences(template, row, rowIndex, idSet, issues);
    validateRowShape(template, row, rowIndex, issues);
  });

  return issues;
}

export function validateContentLength(rows: StoryRow[], maxCharacters: number | null | undefined): ValidationIssue[] {
  if (typeof maxCharacters !== "number" || !Number.isFinite(maxCharacters) || maxCharacters <= 0) {
    return [];
  }

  return rows.flatMap((row, rowIndex) => {
    const content = row.content ?? "";
    const characterCount = countCharacters(content);
    if (characterCount <= maxCharacters) {
      return [];
    }

    return [
      {
        level: "warning" as const,
        rowIndex,
        columnKey: "content",
        message: `正文 ${characterCount} 字，超过上限 ${maxCharacters} 字`,
      },
    ];
  });
}

export function validateRightSideRolePosition(rows: StoryRow[], roleKeyword: string): ValidationIssue[] {
  const keyword = roleKeyword.trim();
  if (!keyword) {
    return [];
  }

  return rows.flatMap((row, rowIndex) => {
    const role = row.role ?? "";
    if (!role.includes(keyword) || row.boxPos === "r") {
      return [];
    }

    return [
      {
        level: "warning" as const,
        rowIndex,
        columnKey: "boxPos",
        message: `人物包含 ${keyword}，位置应为右侧`,
      },
    ];
  });
}

function validateRowReferences(
  template: StoryTemplate,
  row: StoryRow,
  rowIndex: number,
  idSet: Set<string>,
  issues: ValidationIssue[],
) {
  const id = valueOf(row, findColumn(template, "id"));
  const skip = valueOf(row, findColumn(template, "skip"));
  const failSkip = valueOf(row, findColumn(template, "failSkip"));
  const parentId = valueOf(row, findColumn(template, "parent_id"));
  const isBegin = valueOf(row, findColumn(template, "isBegin")) === "TRUE";

  if (skip && !idSet.has(skip)) {
    issues.push({ level: "warning", rowIndex, columnKey: "skip", message: `跳转目标不存在：${id} -> ${skip}` });
  }
  if (failSkip && !idSet.has(failSkip)) {
    issues.push({ level: "warning", rowIndex, columnKey: "failSkip", message: `失败跳转目标不存在：${failSkip}` });
  }
  if (!isBegin && parentId && isLikelyNodeId(parentId) && !idSet.has(parentId)) {
    issues.push({ level: "warning", rowIndex, columnKey: "parent_id", message: `父节点不存在：${parentId}` });
  }
}

function validateRowShape(template: StoryTemplate, row: StoryRow, rowIndex: number, issues: ValidationIssue[]) {
  const sign = valueOf(row, findColumn(template, "sign"));
  const boxPos = valueOf(row, findColumn(template, "boxPos"));
  const content = valueOf(row, findColumn(template, "content"));
  const skip = valueOf(row, findColumn(template, "skip"));
  const isBegin = valueOf(row, findColumn(template, "isBegin"));

  if (boxPos && !["l", "r"].includes(boxPos)) {
    issues.push({ level: "warning", rowIndex, columnKey: "boxPos", message: `位置建议为 l 或 r：${boxPos}` });
  }
  if (isBegin && isBegin !== "TRUE") {
    issues.push({ level: "warning", rowIndex, columnKey: "isBegin", message: "起始点建议填写 TRUE 或留空" });
  }
  if (sign === "#" && !content) {
    issues.push({ level: "warning", rowIndex, columnKey: "content", message: "普通剧情节点内容为空" });
  }
  if (sign === "END" && (content || skip)) {
    issues.push({ level: "warning", rowIndex, columnKey: "sign", message: "END 节点通常不填写内容或跳转" });
  }
}

function hasAnyValue(row: string[]): boolean {
  return row.some((value) => String(value ?? "").trim() !== "");
}

function isLikelyNodeId(value: string): boolean {
  return /^\d+$/.test(value);
}

function findColumn(template: StoryTemplate, preferredKey: string): ColumnTemplate | undefined {
  return template.columns.find((column) => column.key === preferredKey);
}

function valueOf(row: StoryRow, column?: ColumnTemplate): string {
  return column ? (row[column.key] ?? "").trim() : "";
}

function countCharacters(value: string): number {
  return Array.from(value).length;
}
