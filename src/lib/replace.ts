import type { ReplaceOptions, ReplaceResult, StoryRow, StoryTemplate } from "../types";

export function defaultReplaceColumns(template: StoryTemplate): string[] {
  const langColumns = template.columns.filter((column) => column.isLang).map((column) => column.key);
  return langColumns.length > 0 ? langColumns : template.columns.map((column) => column.key);
}

export function applyReplacement(rows: StoryRow[], options: ReplaceOptions): ReplaceResult {
  if (!options.find || options.columns.length === 0) {
    return { rows, matches: 0, affectedCells: 0 };
  }

  const matcher = makeMatcher(options);
  let matches = 0;
  let affectedCells = 0;

  const nextRows = rows.map((row) => {
    const next = { ...row };
    options.columns.forEach((columnKey) => {
      const value = row[columnKey] ?? "";
      const cellMatches = countMatches(value, matcher);
      if (cellMatches > 0) {
        affectedCells += 1;
        matches += cellMatches;
        next[columnKey] = value.replace(makeMatcher(options), options.replace);
      }
    });
    return next;
  });

  return { rows: nextRows, matches, affectedCells };
}

export function previewReplacement(rows: StoryRow[], options: ReplaceOptions): Omit<ReplaceResult, "rows"> {
  const result = applyReplacement(rows, options);
  return {
    matches: result.matches,
    affectedCells: result.affectedCells,
  };
}

function countMatches(value: string, matcher: RegExp): number {
  const matches = value.match(matcher);
  return matches?.length ?? 0;
}

function makeMatcher(options: ReplaceOptions): RegExp {
  const flags = options.matchCase ? "g" : "gi";
  if (options.useRegex) {
    return new RegExp(options.find, flags);
  }
  return new RegExp(escapeRegex(options.find), flags);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
