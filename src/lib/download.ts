export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function filenameWithExt(sourceName: string, extension: string): string {
  const clean = sourceName.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "_") || "story";
  return `${clean}.${extension}`;
}
