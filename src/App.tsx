import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Gift,
  GitBranch,
  Octagon,
  MessageSquare,
  Plus,
  Save,
  Search,
  Settings,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { createEmptyRow, defaultTemplate } from "./defaultTemplate";
import { downloadBlob, filenameWithExt } from "./lib/download";
import { loadDraft, saveDraft } from "./lib/draftStorage";
import { readFileAsArrayBuffer, readFileAsText } from "./lib/fileReaders";
import { applyReplacement, defaultReplaceColumns, previewReplacement } from "./lib/replace";
import { deleteStoryNode, ensureFirstBeginFlag, getEditorColumns, insertStoryNode, nodeTypeLabel } from "./lib/rowActions";
import {
  exportCsvText,
  importCsvText,
  normalizeRows,
  removeColumnFromRows,
  updateColumnKey,
  validateStory,
} from "./lib/storyTable";
import { loadSavedTemplate, saveTemplate } from "./lib/templateStorage";
import { shouldBlockTextareaNewline, stripPastedNewlines } from "./lib/textInput";
import { exportWorkbookBuffer, importWorkbookBuffer } from "./lib/workbook";
import type { ColumnTemplate, ReplaceOptions, StoryRow, StoryTemplate } from "./types";

type StoryNodeKind = "dialogue" | "reward" | "choice" | "end";

type ChoiceItem = {
  option: StoryRow;
  optionIndex: number;
  dialogue?: StoryRow;
  dialogueIndex: number;
};

type ChoiceContext = {
  parentIndex: number;
  parent: StoryRow;
  choices: ChoiceItem[];
};

function initialTemplate(): StoryTemplate {
  return loadDraft()?.template ?? loadSavedTemplate() ?? defaultTemplate;
}

function initialRows(): StoryRow[] {
  return ensureFirstBeginFlag(loadDraft()?.rows ?? []);
}

function initialSourceName(): string {
  return loadDraft()?.sourceName ?? "story.csv";
}

function initialSelectedRow(): number {
  return loadDraft()?.selectedRow ?? 0;
}

function initialStatus(): string {
  const draft = loadDraft();
  return draft ? `已恢复上次草稿，保存于 ${formatSavedAt(draft.savedAt)}` : "默认模板已就绪";
}

export function App() {
  const [template, setTemplate] = useState<StoryTemplate>(() => initialTemplate());
  const [rows, setRows] = useState<StoryRow[]>(() => initialRows());
  const [selectedRow, setSelectedRow] = useState(() => initialSelectedRow());
  const [sourceName, setSourceName] = useState(() => initialSourceName());
  const [status, setStatus] = useState(() => initialStatus());
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(() => loadDraft()?.savedAt ?? null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [undoRows, setUndoRows] = useState<StoryRow[] | null>(null);
  const [replaceOptions, setReplaceOptions] = useState<ReplaceOptions>(() => ({
    find: "",
    replace: "",
    columns: defaultReplaceColumns(initialTemplate()),
    useRegex: false,
    matchCase: false,
  }));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const issues = useMemo(() => validateStory(template, rows), [template, rows]);
  const editorColumns = useMemo(() => getEditorColumns(template, rows), [template, rows]);
  const dialogueConfigColumns = useMemo(() => getDialogueConfigColumns(template), [template]);
  const selected = rows[selectedRow] ?? createEmptyRow(template);
  const choiceContext = useMemo(() => getChoiceContext(rows, selectedRow), [rows, selectedRow]);
  const draftSnapshot = useMemo(() => makeDraftSnapshot({ sourceName, template, rows, selectedRow }), [rows, selectedRow, sourceName, template]);
  const lastSavedSnapshotRef = useRef(draftSnapshot);
  const replacePreview = useMemo(() => {
    try {
      return previewReplacement(rows, replaceOptions);
    } catch {
      return { matches: 0, affectedCells: 0 };
    }
  }, [replaceOptions, rows]);

  useEffect(() => {
    setHasUnsavedChanges(draftSnapshot !== lastSavedSnapshotRef.current);
  }, [draftSnapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!hasUnsavedChanges) {
        return;
      }
      persistDraft("auto");
    }, 15000);
    return () => window.clearInterval(timer);
  }, [hasUnsavedChanges, rows, selectedRow, sourceName, template]);

  function persistDraft(mode: "manual" | "auto") {
    const savedRows = ensureFirstBeginFlag(rows);
    const draft = saveDraft({ sourceName, template, rows: savedRows, selectedRow });
    lastSavedSnapshotRef.current = makeDraftSnapshot({ sourceName, template, rows: savedRows, selectedRow: draft.selectedRow });
    if (savedRows !== rows) {
      setRows(savedRows);
    }
    setLastSavedAt(draft.savedAt);
    setHasUnsavedChanges(false);
    setStatus(mode === "manual" ? `进度已保存：${formatSavedAt(draft.savedAt)}` : `已自动保存：${formatSavedAt(draft.savedAt)}`);
  }

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) {
      return;
    }

    try {
      const extension = file.name.split(".").pop()?.toLowerCase();
      const parsed =
        extension === "xlsx" || extension === "xls"
          ? importWorkbookBuffer(await readFileAsArrayBuffer(file), file.name)
          : importCsvText(await readFileAsText(file), file.name);

      setTemplate(parsed.template);
      setRows(ensureFirstBeginFlag(normalizeRows(parsed.template, parsed.rows)));
      setSelectedRow(0);
      setSourceName(file.name);
      setReplaceOptions((current) => ({ ...current, columns: defaultReplaceColumns(parsed.template) }));
      setStatus(`已导入 ${parsed.rows.length} 个节点，${parsed.template.columns.length} 个导出字段`);
      setHasUnsavedChanges(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function updateCell(rowIndex: number, key: string, value: string) {
    setRows((current) => current.map((row, index) => (index === rowIndex ? { ...row, [key]: value } : row)));
  }

  function addStoryNode(kind: StoryNodeKind) {
    const result = insertStoryNode(template, rows, selectedRow, kind);
    setRows(result.rows);
    setSelectedRow(result.insertedIndex);

    if (kind === "choice") {
      setStatus("已添加选项和分支对话，并自动绑定父节点与汇合节点");
    } else if (kind === "end") {
      setStatus("已添加结束节点，并自动绑定到当前节点之后");
    } else if (kind === "reward") {
      setStatus("已添加奖励，并自动绑定父节点和下一节点");
    } else {
      setStatus("已添加对话，并自动绑定父节点和下一节点");
    }
  }

  function addChoiceToContext(parentIndex: number) {
    const result = insertStoryNode(template, rows, parentIndex, "choice");
    setRows(result.rows);
    setSelectedRow(result.insertedIndex);
    setStatus("已在当前分支组添加选项，并自动绑定分支首句");
  }

  function deleteRow(rowIndex: number) {
    const next = deleteStoryNode(rows, rowIndex);
    setRows(next);
    setSelectedRow(Math.max(0, Math.min(rowIndex, next.length - 1)));
    setStatus("已删除节点，并自动修复线性跳转");
  }

  function clearTable() {
    if (!window.confirm("确认清空当前表格？所有节点都会被删除，并覆盖本地草稿。")) {
      return;
    }

    const clearedRows: StoryRow[] = [];
    const draft = saveDraft({ sourceName, template, rows: clearedRows, selectedRow: 0 });
    setRows(clearedRows);
    setSelectedRow(0);
    setLastSavedAt(draft.savedAt);
    setHasUnsavedChanges(false);
    lastSavedSnapshotRef.current = makeDraftSnapshot({ sourceName, template, rows: clearedRows, selectedRow: 0 });
    setStatus(`表格已清空：${formatSavedAt(draft.savedAt)}`);
  }

  function exportCsv() {
    const exportRows = ensureFirstBeginFlag(rows);
    const blob = new Blob([exportCsvText(template, exportRows)], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, filenameWithExt(sourceName, "csv"));
    setStatus("CSV 已导出");
  }

  function exportXlsx() {
    const buffer = exportWorkbookBuffer(template, ensureFirstBeginFlag(rows));
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    downloadBlob(blob, filenameWithExt(sourceName, "xlsx"));
    setStatus("XLSX 已导出");
  }

  function handleSaveTemplate() {
    saveTemplate(template);
    setStatus("模板已保存到本机浏览器");
  }

  function applyBatchReplace() {
    try {
      setUndoRows(rows);
      const result = applyReplacement(rows, replaceOptions);
      setRows(result.rows);
      setStatus(`替换 ${result.matches} 处，影响 ${result.affectedCells} 个单元格`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "替换表达式无效");
    }
  }

  function restoreReplace() {
    if (!undoRows) {
      return;
    }
    setRows(undoRows);
    setUndoRows(null);
    setStatus("已撤销上一次替换");
  }

  function addColumn() {
    const key = nextColumnKey(template);
    const column: ColumnTemplate = { key, valueType: "string", label: "新字段", channel: "c", isLang: false };
    setTemplate((current) => ({ ...current, columns: [...current.columns, column] }));
    setRows((current) => current.map((row) => ({ ...row, [key]: "" })));
  }

  function removeColumn(key: string) {
    if (!window.confirm(`删除字段 ${key}？`)) {
      return;
    }
    setTemplate((current) => ({ ...current, columns: current.columns.filter((column) => column.key !== key) }));
    setRows((current) => removeColumnFromRows(current, key));
    setReplaceOptions((current) => ({ ...current, columns: current.columns.filter((columnKey) => columnKey !== key) }));
  }

  function updateColumn(index: number, patch: Partial<ColumnTemplate>) {
    setTemplate((current) => {
      const existing = current.columns[index];
      if (!existing) {
        return current;
      }

      if (patch.key && patch.key !== existing.key) {
        const cleanKey = patch.key.trim();
        if (!cleanKey || current.columns.some((column, columnIndex) => columnIndex !== index && column.key === cleanKey)) {
          setStatus("字段名不能为空，也不能重复");
          return current;
        }
        setRows((currentRows) => updateColumnKey(currentRows, existing.key, cleanKey));
        setReplaceOptions((currentOptions) => ({
          ...currentOptions,
          columns: currentOptions.columns.map((columnKey) => (columnKey === existing.key ? cleanKey : columnKey)),
        }));
      }

      const columns = current.columns.map((column, columnIndex) =>
        columnIndex === index ? { ...column, ...patch, key: patch.key?.trim() ?? column.key } : column,
      );
      return { ...current, columns };
    });
  }

  function moveColumn(index: number, direction: -1 | 1) {
    setTemplate((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.columns.length) {
        return current;
      }
      const columns = [...current.columns];
      const [column] = columns.splice(index, 1);
      columns.splice(nextIndex, 0, column);
      return { ...current, columns };
    });
  }

  function toggleReplaceColumn(key: string) {
    setReplaceOptions((current) => ({
      ...current,
      columns: current.columns.includes(key)
        ? current.columns.filter((columnKey) => columnKey !== key)
        : [...current.columns, key],
    }));
  }

  return (
    <main
      className={`app ${dragging ? "is-dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void handleFiles(event.dataTransfer.files);
      }}
    >
      <header className="toolbar">
        <div className="brand">
          <FileSpreadsheet size={24} aria-hidden="true" />
          <div>
            <h1>剧情编辑器</h1>
            <span>{sourceName}</span>
          </div>
        </div>
        <div className="toolbar-actions">
          <input ref={fileInputRef} hidden type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void handleFiles(event.target.files)} />
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            <Upload size={16} aria-hidden="true" />
            导入
          </button>
          <button type="button" onClick={exportCsv}>
            <Download size={16} aria-hidden="true" />
            CSV
          </button>
          <button type="button" onClick={exportXlsx}>
            <FileSpreadsheet size={16} aria-hidden="true" />
            XLSX
          </button>
          <button type="button" onClick={handleSaveTemplate}>
            <Save size={16} aria-hidden="true" />
            保存模板
          </button>
          <button type="button" onClick={() => persistDraft("manual")}>
            <Save size={16} aria-hidden="true" />
            保存进度
          </button>
          <button type="button" onClick={() => addStoryNode("dialogue")}>
            <MessageSquare size={16} aria-hidden="true" />
            添加对话
          </button>
          <button type="button" onClick={() => addStoryNode("choice")}>
            <GitBranch size={16} aria-hidden="true" />
            添加选项
          </button>
          <button type="button" onClick={() => addStoryNode("reward")}>
            <Gift size={16} aria-hidden="true" />
            添加奖励
          </button>
          <button type="button" onClick={() => addStoryNode("end")}>
            <Octagon size={16} aria-hidden="true" />
            添加结束
          </button>
          <button type="button" onClick={clearTable}>
            <Trash2 size={16} aria-hidden="true" />
            清空表格
          </button>
        </div>
      </header>

      <section className="status-strip">
        <span>{status}</span>
        <span>{rows.length} 个节点</span>
        <span>显示 {editorColumns.length} 项</span>
        <span>导出 {template.columns.length} 列</span>
        <span className={hasUnsavedChanges ? "bad" : "good"}>{hasUnsavedChanges ? "未保存" : lastSavedAt ? `已保存 ${formatSavedAt(lastSavedAt)}` : "未生成草稿"}</span>
        <span className={issues.some((issue) => issue.level === "error") ? "bad" : "good"}>
          {issues.length === 0 ? "无校验问题" : `${issues.length} 个校验提示`}
        </span>
      </section>

      <div className="workspace">
        <section className="editor-pane">
          <div className="table-wrap">
            <table className="story-table">
              <thead>
                <tr>
                  <th className="row-head">#</th>
                  {editorColumns.map((column) => (
                    <th key={column.key}>
                      <span>{column.label || column.key}</span>
                      <small>{column.key}</small>
                    </th>
                  ))}
                  <th className="row-head"> </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="empty-table" colSpan={editorColumns.length + 2}>
                      导入表格，或点击“添加对话”开始新剧情。
                    </td>
                  </tr>
                ) : (
                  rows.map((row, rowIndex) => (
                    <tr key={`${row.id || "row"}-${rowIndex}`} className={selectedRow === rowIndex ? "selected" : ""}>
                      <td className="row-head">
                        <button type="button" title="选中节点" className="row-number" onClick={() => setSelectedRow(rowIndex)}>
                          {rowIndex + 1}
                        </button>
                      </td>
                      {editorColumns.map((column) => (
                        <td key={column.key} className={column.key === "content" ? "content-cell" : undefined}>
                          <EditableCell column={column} row={row} rowIndex={rowIndex} onFocus={setSelectedRow} onChange={updateCell} />
                        </td>
                      ))}
                      <td className="row-head">
                        <button type="button" title="删除节点" className="icon-button danger" onClick={() => deleteRow(rowIndex)}>
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="side-pane">
          <section className="panel">
            <div className="panel-title">
              <FileSpreadsheet size={17} aria-hidden="true" />
              <h2>文件信息</h2>
            </div>
            <label className="file-name-field">
              文件名
              <input value={sourceName} onChange={(event) => setSourceName(event.target.value)} />
            </label>
          </section>

          <section className="panel preview-panel">
            <div className="panel-title">
              <CheckCircle2 size={17} aria-hidden="true" />
              <h2>预览</h2>
            </div>
            <dl className="node-meta">
              <div>
                <dt>类型</dt>
                <dd>{rows.length === 0 ? "-" : nodeTypeLabel(selected)}</dd>
              </div>
              <div>
                <dt>角色</dt>
                <dd>{selected.role || "旁白"}</dd>
              </div>
              <div>
                <dt>位置</dt>
                <dd>{selected.boxPos === "r" ? "右" : "左"}</dd>
              </div>
              <div>
                <dt>字数</dt>
                <dd>{countCharacters(selected.content || "")}</dd>
              </div>
            </dl>
            <p className={`dialogue ${selected.boxPos === "r" ? "right" : "left"}`}>
              {selected.reward ? `奖励：${selected.reward}` : selected.content || "当前节点没有正文内容"}
            </p>
          </section>

          {rows.length > 0 && (
            <section className="panel">
              <div className="panel-title">
                <GitBranch size={17} aria-hidden="true" />
                <h2>选项配置</h2>
              </div>
              {choiceContext ? (
                <>
                  <p className="panel-note">同组选项会从同一句对话分出，分支首句会自动接回共同后续节点。</p>
                  <div className="choice-list">
                    {choiceContext.choices.map((choice, index) => (
                      <div className="choice-editor" key={choice.option.id || index}>
                        <label>
                          选项文本
                          <input
                            value={choice.option.content ?? ""}
                            onFocus={() => setSelectedRow(choice.optionIndex)}
                            onChange={(event) => updateCell(choice.optionIndex, "content", event.target.value)}
                          />
                        </label>
                        <label>
                          分支首句
                          <textarea
                            value={choice.dialogue?.content ?? ""}
                            onKeyDown={handleTextareaKeyDown}
                            onPaste={(event) =>
                              choice.dialogueIndex >= 0 &&
                              handleTextareaPaste(event, choice.dialogue?.content ?? "", (value) => updateCell(choice.dialogueIndex, "content", value))
                            }
                            onFocus={() => choice.dialogueIndex >= 0 && setSelectedRow(choice.dialogueIndex)}
                            onChange={(event) => choice.dialogueIndex >= 0 && updateCell(choice.dialogueIndex, "content", event.target.value)}
                          />
                        </label>
                        <div className="choice-actions">
                          <button type="button" onClick={() => setSelectedRow(choice.optionIndex)}>
                            选项行
                          </button>
                          <button type="button" onClick={() => choice.dialogueIndex >= 0 && setSelectedRow(choice.dialogueIndex)} disabled={choice.dialogueIndex < 0}>
                            分支行
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => addChoiceToContext(choiceContext.parentIndex)}>
                    <Plus size={16} aria-hidden="true" />
                    添加同组选项
                  </button>
                </>
              ) : selected.sign !== "END" && selected.sign !== "$" ? (
                <button type="button" onClick={() => addStoryNode("choice")}>
                  <Plus size={16} aria-hidden="true" />
                  给当前对话添加选项
                </button>
              ) : (
                <p className="empty">当前节点不需要配置选项</p>
              )}
            </section>
          )}

          {rows.length > 0 && selected.sign === "#" && dialogueConfigColumns.length > 0 && (
            <section className="panel">
              <div className="panel-title">
                <Settings size={17} aria-hidden="true" />
                <h2>对话配置</h2>
              </div>
              <div className="dialogue-config">
                {dialogueConfigColumns.map((column) => (
                  <label key={column.key}>
                    {column.label || column.key}
                    <input value={selected[column.key] ?? ""} onChange={(event) => updateCell(selectedRow, column.key, event.target.value)} />
                  </label>
                ))}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-title">
              <Search size={17} aria-hidden="true" />
              <h2>批量替换</h2>
            </div>
            <div className="form-grid">
              <label>
                查找
                <input value={replaceOptions.find} onChange={(event) => setReplaceOptions((current) => ({ ...current, find: event.target.value }))} />
              </label>
              <label>
                替换为
                <input value={replaceOptions.replace} onChange={(event) => setReplaceOptions((current) => ({ ...current, replace: event.target.value }))} />
              </label>
            </div>
            <div className="check-row">
              <label>
                <input type="checkbox" checked={replaceOptions.useRegex} onChange={(event) => setReplaceOptions((current) => ({ ...current, useRegex: event.target.checked }))} />
                正则
              </label>
              <label>
                <input type="checkbox" checked={replaceOptions.matchCase} onChange={(event) => setReplaceOptions((current) => ({ ...current, matchCase: event.target.checked }))} />
                区分大小写
              </label>
            </div>
            <div className="column-pills">
              {editorColumns.map((column) => (
                <label key={column.key} className={replaceOptions.columns.includes(column.key) ? "pill active" : "pill"}>
                  <input type="checkbox" checked={replaceOptions.columns.includes(column.key)} onChange={() => toggleReplaceColumn(column.key)} />
                  {column.label || column.key}
                </label>
              ))}
            </div>
            <div className="button-row">
              <button type="button" onClick={applyBatchReplace} disabled={!replaceOptions.find}>
                <Search size={16} aria-hidden="true" />
                替换 {replacePreview.matches}
              </button>
              <button type="button" onClick={restoreReplace} disabled={!undoRows}>
                <Undo2 size={16} aria-hidden="true" />
                撤销
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <AlertTriangle size={17} aria-hidden="true" />
              <h2>校验</h2>
            </div>
            <div className="issue-list">
              {issues.length === 0 ? (
                <p className="empty">结构看起来正常</p>
              ) : (
                issues.slice(0, 30).map((issue, index) => (
                  <button key={`${issue.message}-${index}`} type="button" className={`issue ${issue.level}`} onClick={() => issue.rowIndex >= 0 && setSelectedRow(issue.rowIndex)}>
                    <strong>{issue.rowIndex >= 0 ? `第 ${issue.rowIndex + 1} 个节点` : "全表"}</strong>
                    <span>{issue.message}</span>
                  </button>
                ))
              )}
            </div>
          </section>

          <details className="panel template-panel">
            <summary className="panel-title">
              <Settings size={17} aria-hidden="true" />
              <h2>表结构</h2>
            </summary>
            <div className="template-name">
              <input value={template.name} onChange={(event) => setTemplate((current) => ({ ...current, name: event.target.value }))} />
              <button type="button" title="新增字段" className="icon-button" onClick={addColumn}>
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="columns-editor">
              {template.columns.map((column, index) => (
                <div className="column-editor" key={column.key}>
                  <input aria-label="字段名" value={column.key} onChange={(event) => updateColumn(index, { key: event.target.value })} />
                  <input aria-label="类型" value={column.valueType} onChange={(event) => updateColumn(index, { valueType: event.target.value })} />
                  <input aria-label="中文名" value={column.label} onChange={(event) => updateColumn(index, { label: event.target.value, isLang: event.target.value.includes("#Lang") })} />
                  <input aria-label="端侧" value={column.channel} onChange={(event) => updateColumn(index, { channel: event.target.value })} />
                  <label title="多语言字段">
                    <input type="checkbox" checked={column.isLang} onChange={(event) => updateColumn(index, { isLang: event.target.checked })} />
                    Lang
                  </label>
                  <button type="button" title="上移" className="icon-button" onClick={() => moveColumn(index, -1)}>
                    <ArrowUp size={14} aria-hidden="true" />
                  </button>
                  <button type="button" title="下移" className="icon-button" onClick={() => moveColumn(index, 1)}>
                    <ArrowDown size={14} aria-hidden="true" />
                  </button>
                  <button type="button" title="删除字段" className="icon-button danger" onClick={() => removeColumn(column.key)}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </details>
        </aside>
      </div>
    </main>
  );
}

function EditableCell({
  column,
  row,
  rowIndex,
  onFocus,
  onChange,
}: {
  column: ColumnTemplate;
  row: StoryRow;
  rowIndex: number;
  onFocus: (rowIndex: number) => void;
  onChange: (rowIndex: number, key: string, value: string) => void;
}) {
  if (!isCellNeeded(row, column.key)) {
    return <span className="not-needed">-</span>;
  }

  if (column.key === "boxPos") {
    return (
      <PositionSwitch
        value={row[column.key] ?? "l"}
        onFocus={() => onFocus(rowIndex)}
        onChange={(value) => onChange(rowIndex, column.key, value)}
      />
    );
  }

  if (column.key === "content") {
    return (
      <label className="content-editor">
        <textarea
          value={row[column.key] ?? ""}
          onKeyDown={handleTextareaKeyDown}
          onPaste={(event) => handleTextareaPaste(event, row[column.key] ?? "", (value) => onChange(rowIndex, column.key, value))}
          onFocus={() => onFocus(rowIndex)}
          onChange={(event) => onChange(rowIndex, column.key, event.target.value)}
        />
        <span>{countCharacters(row[column.key] ?? "")}</span>
      </label>
    );
  }

  return <input value={row[column.key] ?? ""} onFocus={() => onFocus(rowIndex)} onChange={(event) => onChange(rowIndex, column.key, event.target.value)} />;
}

function PositionSwitch({ value, onFocus, onChange }: { value: string; onFocus: () => void; onChange: (value: string) => void }) {
  const checked = value === "r";
  return (
    <label className="switch-control">
      <input
        type="checkbox"
        checked={checked}
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.checked ? "r" : "l")}
      />
      <span className="switch-track" aria-hidden="true" />
      <strong>{checked ? "右" : "左"}</strong>
    </label>
  );
}

function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (shouldBlockTextareaNewline(event.key, event.altKey)) {
    event.preventDefault();
  }
}

function handleTextareaPaste(event: ClipboardEvent<HTMLTextAreaElement>, currentValue: string, commit: (value: string) => void) {
  const pasted = event.clipboardData.getData("text");
  const cleaned = stripPastedNewlines(pasted);
  if (cleaned === pasted) {
    return;
  }

  event.preventDefault();
  const target = event.currentTarget;
  const selectionStart = target.selectionStart;
  const selectionEnd = target.selectionEnd;
  const nextValue = `${currentValue.slice(0, selectionStart)}${cleaned}${currentValue.slice(selectionEnd)}`;
  commit(nextValue);

  window.requestAnimationFrame(() => {
    target.selectionStart = selectionStart + cleaned.length;
    target.selectionEnd = selectionStart + cleaned.length;
  });
}

function isCellNeeded(row: StoryRow, key: string): boolean {
  if (row.sign === "END") {
    return false;
  }
  if (row.sign === "&") {
    return key === "content";
  }
  if (row.sign === "$" || row.reward) {
    return key === "reward";
  }
  return key !== "reward";
}

function getChoiceContext(rows: StoryRow[], selectedRow: number): ChoiceContext | null {
  if (rows.length === 0) {
    return null;
  }

  const safeIndex = Math.max(0, Math.min(selectedRow, rows.length - 1));
  const selected = rows[safeIndex];
  let parentIndex = -1;

  if (selected.sign === "&") {
    parentIndex = rows.findIndex((row) => row.id === selected.parent_id);
  } else {
    const selectedParentIndex = rows.findIndex((row) => row.id === selected.parent_id);
    if (rows[selectedParentIndex]?.sign === "&") {
      parentIndex = rows.findIndex((row) => row.id === rows[selectedParentIndex].parent_id);
    } else if (rows.some((row) => row.sign === "&" && row.parent_id === selected.id)) {
      parentIndex = safeIndex;
    }
  }

  if (parentIndex < 0) {
    return null;
  }

  const parent = rows[parentIndex];
  const choices = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.sign === "&" && row.parent_id === parent.id)
    .map(({ row, index }) => {
      const dialogueIndex = rows.findIndex((candidate) => candidate.id === row.skip);
      return {
        option: row,
        optionIndex: index,
        dialogue: dialogueIndex >= 0 ? rows[dialogueIndex] : undefined,
        dialogueIndex,
      };
    });

  return choices.length > 0 ? { parentIndex, parent, choices } : null;
}

function getDialogueConfigColumns(template: StoryTemplate): ColumnTemplate[] {
  const excluded = new Set(["id", "isBegin", "sign", "parent_id", "skip", "failSkip", "role", "boxPos", "content", "reward"]);
  return template.columns.filter((column) => !excluded.has(column.key));
}

function nextColumnKey(template: StoryTemplate): string {
  let index = template.columns.length + 1;
  let key = `field_${index}`;
  const used = new Set(template.columns.map((column) => column.key));
  while (used.has(key)) {
    index += 1;
    key = `field_${index}`;
  }
  return key;
}

function countCharacters(value: string): number {
  return Array.from(value).length;
}

function makeDraftSnapshot(input: { sourceName: string; template: StoryTemplate; rows: StoryRow[]; selectedRow: number }): string {
  return JSON.stringify(input);
}

function formatSavedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
