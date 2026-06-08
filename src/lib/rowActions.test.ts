import { describe, expect, it } from "vitest";
import branchSample from "../__fixtures__/71003.csv?raw";
import linearSample from "../__fixtures__/100101-1.csv?raw";
import { defaultTemplate } from "../defaultTemplate";
import { importCsvText } from "./storyTable";
import { ensureFirstBeginFlag, getEditorColumns, insertStoryNode, nodeTypeLabel } from "./rowActions";

describe("story node actions", () => {
  it("recognizes branch option nodes from the reference table", () => {
    const parsed = importCsvText(branchSample, "71003.csv");

    expect(parsed.rows).toHaveLength(8);
    expect(parsed.rows.filter((row) => row.sign === "&")).toHaveLength(3);
    expect(nodeTypeLabel(parsed.rows[1])).toBe("选项");
    expect(getEditorColumns(parsed.template, parsed.rows).map((column) => column.key)).toEqual(["role", "boxPos", "content"]);
  });

  it("adds an option branch into an existing option group", () => {
    const parsed = importCsvText(branchSample, "71003.csv");
    const result = insertStoryNode(parsed.template, parsed.rows, 0, "choice");
    const option = result.rows.find((row) => row.id === "2491");
    const dialogue = result.rows.find((row) => row.id === "2492");

    expect(option).toMatchObject({
      sign: "&",
      parent_id: "2489",
      content: "新选项",
      skip: "2492",
    });
    expect(dialogue).toMatchObject({
      sign: "#",
      parent_id: "2483",
      skip: "2490",
      boxPos: "l",
    });
    expect(result.rows[0].skip).toBe("2483");
  });

  it("turns a linear node into a branch without losing the old next target", () => {
    const parsed = importCsvText(linearSample, "100101-1.csv");
    const result = insertStoryNode(parsed.template, parsed.rows, 0, "choice");
    const option = result.rows.find((row) => row.id === "1970");
    const dialogue = result.rows.find((row) => row.id === "1971");

    expect(result.rows[0].skip).toBe("1970");
    expect(option).toMatchObject({ sign: "&", parent_id: "1933", skip: "1971" });
    expect(dialogue).toMatchObject({ sign: "#", parent_id: "1970", skip: "1934" });
  });

  it("creates new dialogue nodes with left position by default", () => {
    const result = insertStoryNode(defaultTemplate, [], 0, "dialogue");

    expect(result.rows[0]).toMatchObject({
      isBegin: "TRUE",
      sign: "#",
      boxPos: "l",
    });
  });

  it("marks the first option node as begin when a story starts with choices", () => {
    const result = insertStoryNode(defaultTemplate, [], 0, "choice");

    expect(result.rows[0]).toMatchObject({
      isBegin: "TRUE",
      sign: "&",
    });
  });

  it("adds a begin flag to imported rows that do not have one", () => {
    const rows = ensureFirstBeginFlag([
      { id: "10", sign: "#", content: "start" },
      { id: "11", sign: "END" },
    ]);

    expect(rows[0].isBegin).toBe("TRUE");
  });

  it("creates an end node from an empty story", () => {
    const result = insertStoryNode(defaultTemplate, [], 0, "end");

    expect(result.rows[0]).toMatchObject({
      isBegin: "TRUE",
      sign: "END",
    });
  });

  it("links the current node to a newly inserted end node", () => {
    const first = insertStoryNode(defaultTemplate, [], 0, "dialogue");
    const result = insertStoryNode(defaultTemplate, first.rows, 0, "end");

    expect(result.rows[0].skip).toBe("2");
    expect(result.rows[1]).toMatchObject({
      id: "2",
      sign: "END",
      parent_id: "1",
    });
  });
});
