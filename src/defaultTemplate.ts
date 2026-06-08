import type { StoryRow, StoryTemplate } from "./types";

export const defaultTemplate: StoryTemplate = {
  id: "story-csv-v1",
  name: "剧情表默认模板",
  columns: [
    { key: "id", valueType: "int", label: "子ID", channel: "c/s", isLang: false },
    { key: "isBegin", valueType: "string", label: "起始点", channel: "c", isLang: false },
    { key: "sign", valueType: "string", label: "标志", channel: "c", isLang: false },
    { key: "parent_id", valueType: "int", label: "父ID", channel: "c", isLang: false },
    { key: "bgmPath", valueType: "string", label: "背景BGM", channel: "c", isLang: false },
    { key: "role", valueType: "string", label: "人物#Lang", channel: "c", isLang: true },
    { key: "roleID", valueType: "string", label: "人物ID", channel: "c", isLang: false },
    { key: "boxPos", valueType: "string", label: "位置", channel: "c", isLang: false },
    { key: "content", valueType: "string", label: "对话内容#Lang", channel: "c", isLang: true },
    { key: "mp3Path", valueType: "string", label: "MP3路径", channel: "c", isLang: false },
    { key: "backPic", valueType: "string", label: "背景图片", channel: "c", isLang: false },
    { key: "skip", valueType: "int", label: "跳转", channel: "c", isLang: false },
    { key: "failSkip", valueType: "string", label: "失败跳转", channel: "c", isLang: false },
    { key: "reward", valueType: "string", label: "奖励", channel: "c/s", isLang: false },
  ],
};

export function createEmptyRow(template: StoryTemplate = defaultTemplate): StoryRow {
  return Object.fromEntries(template.columns.map((column) => [column.key, ""]));
}
