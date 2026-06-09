export type ColumnTemplate = {
  key: string;
  valueType: string;
  label: string;
  channel: string;
  isLang: boolean;
};

export type StoryTemplate = {
  id: string;
  name: string;
  columns: ColumnTemplate[];
};

export type StoryRow = Record<string, string>;

export type ValidationIssue = {
  level: "warning" | "error";
  rowIndex: number;
  columnKey?: string;
  kind?: "length" | "position";
  message: string;
};

export type ParsedStory = {
  template: StoryTemplate;
  rows: StoryRow[];
};

export type ReplaceOptions = {
  find: string;
  replace: string;
  columns: string[];
  useRegex: boolean;
  matchCase: boolean;
};

export type ReplaceResult = {
  rows: StoryRow[];
  matches: number;
  affectedCells: number;
};
