export function shouldBlockTextareaNewline(key: string, altKey: boolean, ctrlKey = false): boolean {
  return key === "Enter" && !altKey && !ctrlKey;
}

export function stripPastedNewlines(value: string): string {
  return value;
}
