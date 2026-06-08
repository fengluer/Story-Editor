import * as XLSX from "xlsx";
import type { ParsedStory, StoryRow, StoryTemplate } from "../types";
import { buildMatrix, importMatrix } from "./storyTable";

export function importWorkbookBuffer(buffer: ArrayBuffer, sourceName: string): ParsedStory {
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return importMatrix([], sourceName);
  }

  const matrix = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[firstSheetName], {
    header: 1,
    defval: "",
    raw: false,
  });

  return importMatrix(matrix, sourceName);
}

export function exportWorkbookBuffer(template: StoryTemplate, rows: StoryRow[]): ArrayBuffer {
  const matrix = buildMatrix(template, rows);
  const worksheet = XLSX.utils.aoa_to_sheet(matrix);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "剧情表");
  return XLSX.write(workbook, { bookType: "xlsx", type: "array" });
}
