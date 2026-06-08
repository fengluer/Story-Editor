export function shouldBlockTextareaNewline(key: string, altKey: boolean): boolean {
  return key === "Enter" && !altKey;
}

export function stripPastedNewlines(value: string): string {
  return value.replace(/[\r\n]+/g, "");
}
