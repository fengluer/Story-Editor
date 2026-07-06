export function shouldBlockTextareaNewline(key: string, altKey: boolean, ctrlKey = false): boolean {
  return key === "Enter" && !ctrlKey;
}

export function stripPastedNewlines(value: string): string {
  // Remove trailing newlines only; preserve newlines within the text.
  return value.replace(/[\r\n]+$/, "");
}
