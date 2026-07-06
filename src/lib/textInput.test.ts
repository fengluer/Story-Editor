import { describe, expect, it } from "vitest";
import { shouldBlockTextareaNewline, stripPastedNewlines } from "./textInput";

describe("textarea input rules", () => {
  it("blocks plain Enter", () => {
    expect(shouldBlockTextareaNewline("Enter", false)).toBe(true);
  });

  it("allows Alt+Enter", () => {
    expect(shouldBlockTextareaNewline("Enter", true)).toBe(false);
  });

  it("allows Ctrl+Enter", () => {
    expect(shouldBlockTextareaNewline("Enter", false, true)).toBe(false);
  });

  it("allows other keys", () => {
    expect(shouldBlockTextareaNewline("A", false)).toBe(false);
  });

  it("keeps pasted newline characters", () => {
    expect(stripPastedNewlines("第一行\n第二行\r\n第三行")).toBe("第一行\n第二行\r\n第三行");
  });
});
