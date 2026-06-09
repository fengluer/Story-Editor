export type SaveBlobResult = {
  state: "saved" | "canceled" | "started";
  filePath?: string;
};

export async function saveBlob(
  blob: Blob,
  fileName: string,
  filters: StoryEditorFileFilter[] = [],
): Promise<SaveBlobResult> {
  if (window.storyEditorFile) {
    const result = await window.storyEditorFile.save({
      fileName,
      data: await blob.arrayBuffer(),
      filters,
    });
    return result.saved ? { state: "saved", filePath: result.filePath } : { state: "canceled" };
  }

  downloadBlob(blob, fileName);
  return { state: "started" };
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function filenameWithExt(sourceName: string, extension: string): string {
  const clean = sourceName.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "_") || "story";
  return `${clean}.${extension}`;
}
