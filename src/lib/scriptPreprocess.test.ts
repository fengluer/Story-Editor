import { describe, expect, it } from "vitest";
import { defaultTemplate } from "../defaultTemplate";
import { insertScriptRowsFromClipboard, parseScriptClipboard } from "./scriptPreprocess";

describe("script preprocessing", () => {
  it("reads Excel clipboard rows as scene, role and content", () => {
    const parsed = parseScriptClipboard("场景\t角色名\t正文\r\nbg_a.png\t旁白\t清晨的房间很安静。\r\nbg_a.png\t李雷\t你醒了吗？\r\n");

    expect(parsed.skippedCount).toBe(0);
    expect(parsed.entries).toEqual([
      { scene: "bg_a.png", role: "旁白", content: "清晨的房间很安静。" },
      { scene: "bg_a.png", role: "李雷", content: "你醒了吗？" },
    ]);
  });

  it("creates linked dialogue rows and clears narrator role", () => {
    const result = insertScriptRowsFromClipboard(defaultTemplate, [], 0, "bg_a.png\t旁白\t清晨的房间很安静。\r\nbg_b.png\t李雷\t你醒了吗？");

    expect(result.insertedCount).toBe(2);
    expect(result.narratorCount).toBe(1);
    expect(result.rows[0]).toMatchObject({
      id: "1",
      isBegin: "TRUE",
      sign: "#",
      parent_id: "",
      skip: "2",
      backPic: "bg_a.png",
      role: "",
      content: "清晨的房间很安静。",
    });
    expect(result.rows[1]).toMatchObject({
      id: "2",
      sign: "#",
      parent_id: "1",
      skip: "",
      backPic: "bg_b.png",
      role: "李雷",
      content: "你醒了吗？",
    });
  });

  it("inserts after the selected node and preserves the old next target", () => {
    const rows = [
      { id: "10", isBegin: "TRUE", sign: "#", parent_id: "", skip: "11", content: "start", boxPos: "r" },
      { id: "11", isBegin: "", sign: "#", parent_id: "10", skip: "", content: "end", boxPos: "l" },
    ];
    const result = insertScriptRowsFromClipboard(defaultTemplate, rows, 0, "bg.png\t韩梅梅\t插入一句");

    expect(result.insertedIndex).toBe(1);
    expect(result.rows[0].skip).toBe("12");
    expect(result.rows[1]).toMatchObject({
      id: "12",
      sign: "#",
      parent_id: "10",
      skip: "11",
      boxPos: "r",
      backPic: "bg.png",
      role: "韩梅梅",
      content: "插入一句",
    });
  });
});
