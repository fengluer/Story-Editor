import { describe, expect, it } from "vitest";
import sample from "../__fixtures__/100101-1.csv?raw";
import { applyReplacement, defaultReplaceColumns } from "./replace";
import { exportWorkbookBuffer, importWorkbookBuffer } from "./workbook";
import { buildMatrix, exportCsvText, importCsvText, importMatrix, validateStory } from "./storyTable";
import { defaultTemplate } from "../defaultTemplate";

const expectedKeys = [
  "id",
  "isBegin",
  "sign",
  "parent_id",
  "bgmPath",
  "role",
  "roleID",
  "boxPos",
  "content",
  "mp3Path",
  "backPic",
  "skip",
  "failSkip",
  "reward",
];

describe("story table format", () => {
  it("parses the sample four-row header and data rows", () => {
    const parsed = importCsvText(sample, "100101-1.csv");

    expect(parsed.template.columns.map((column) => column.key)).toEqual(expectedKeys);
    expect(parsed.template.columns).toHaveLength(14);
    expect(parsed.rows).toHaveLength(35);
    expect(parsed.rows[0].id).toBe("1933");
    expect(parsed.rows.at(-1)?.sign).toBe("END");
  });

  it("exports csv with the same metadata shape", () => {
    const parsed = importCsvText(sample, "100101-1.csv");
    const reparsed = importCsvText(exportCsvText(parsed.template, parsed.rows), "roundtrip.csv");
    const matrix = buildMatrix(reparsed.template, reparsed.rows);

    expect(matrix.slice(0, 4)).toEqual(buildMatrix(parsed.template, parsed.rows).slice(0, 4));
    expect(reparsed.rows).toHaveLength(parsed.rows.length);
  });

  it("roundtrips workbook exports through the first worksheet", () => {
    const parsed = importCsvText(sample, "100101-1.csv");
    const buffer = exportWorkbookBuffer(parsed.template, parsed.rows);
    const reparsed = importWorkbookBuffer(buffer, "roundtrip.xlsx");

    expect(reparsed.template.columns.map((column) => column.key)).toEqual(expectedKeys);
    expect(reparsed.rows).toHaveLength(35);
    expect(reparsed.rows[17].content).toContain("春天");
  });

  it("replaces text only in selected language columns", () => {
    const parsed = importCsvText(sample, "100101-1.csv");
    const result = applyReplacement(parsed.rows, {
      find: "春天",
      replace: "初夏",
      columns: defaultReplaceColumns(parsed.template).filter((key) => key === "content"),
      useRegex: false,
      matchCase: true,
    });

    expect(result.matches).toBe(4);
    expect(result.affectedCells).toBe(4);
    expect(result.rows[17].content).toContain("初夏");
    expect(result.rows[17].role).toBe(parsed.rows[17].role);
  });

  it("keeps edited template metadata in exported matrices", () => {
    const parsed = importCsvText(sample, "100101-1.csv");
    const template = {
      ...parsed.template,
      columns: [...parsed.template.columns, { key: "memo", valueType: "string", label: "备注#Lang", channel: "c", isLang: true }],
    };
    const rows = parsed.rows.map((row) => ({ ...row, memo: "ok" }));
    const reparsed = importMatrix(buildMatrix(template, rows), "template.csv");

    expect(reparsed.template.columns.at(-1)?.key).toBe("memo");
    expect(reparsed.template.columns.at(-1)?.label).toBe("备注#Lang");
    expect(reparsed.rows[0].memo).toBe("ok");
  });

  it("reports no reference problems for the sample", () => {
    const parsed = importCsvText(sample, "100101-1.csv");
    expect(validateStory(parsed.template, parsed.rows)).toEqual([]);
  });

  it("does not validate parent references for begin nodes", () => {
    const issues = validateStory(defaultTemplate, [
      { id: "1", isBegin: "TRUE", sign: "#", parent_id: "999", content: "start", boxPos: "l", skip: "2" },
      { id: "2", sign: "END", parent_id: "1" },
    ]);

    expect(issues.some((issue) => issue.columnKey === "parent_id")).toBe(false);
  });

  it("still validates parent references for non-begin nodes", () => {
    const issues = validateStory(defaultTemplate, [
      { id: "1", isBegin: "TRUE", sign: "#", content: "start", boxPos: "l", skip: "2" },
      { id: "2", sign: "#", parent_id: "999", content: "child", boxPos: "l" },
    ]);

    expect(issues.some((issue) => issue.columnKey === "parent_id")).toBe(true);
  });
});
