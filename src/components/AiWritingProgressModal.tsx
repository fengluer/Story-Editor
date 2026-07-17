import { Check, LoaderCircle, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import type { AiProjectSettings, AiWritingSession } from "../ai/types";

export function AiWritingProgressModal({ session, settings, language, onDiscard, onStop, onRetry, onConfirm }: {
  session: AiWritingSession;
  settings: AiProjectSettings;
  language: "zh" | "en";
  onDiscard: () => void;
  onStop: () => void;
  onRetry: () => void;
  onConfirm: () => void;
}) {
  const previewIds = new Set(session.previewRowIds);
  const previewRows = session.rows.filter((row) => previewIds.has(row.id));
  const sceneName = settings.scenes.find((scene) => scene.id === session.runtime.activeSceneId)?.name || session.runtime.activeSceneId;
  const completed = session.status === "completed";
  const running = session.status === "running" || session.status === "validating";
  const canConfirm = session.previewRowIds.length > 0 && ["completed", "stopped", "failed"].includes(session.status);
  const canRetry = ["failed", "stopped", "validation_failed"].includes(session.status);

  return (
    <div className="ai-modal-backdrop" role="presentation">
      <section className="ai-modal ai-writing-progress-modal" role="dialog" aria-modal="true" aria-labelledby="ai-writing-progress-title">
        <header className="ai-modal-header">
          <div>
            <span className="ai-modal-kicker"><Sparkles size={15} aria-hidden="true" /> AI</span>
            <h2 id="ai-writing-progress-title">{text(language, "当前编写情况", "Writing Preview")}</h2>
            <p>{completed ? text(language, "生成完成。确认后才会写入编辑器。", "Generation is complete. It will only be written after confirmation.") : canConfirm ? text(language, "生成已停止，可写入当前已生成部分。", "Generation has stopped; the generated portion can be written.") : text(language, "正在生成工作副本，编辑器内容尚未改变。", "Generating a working copy; the editor remains unchanged.")}</p>
          </div>
          {running && <LoaderCircle className="ai-progress-spinner" size={22} aria-hidden="true" />}
        </header>
        <div className="ai-writing-progress-body">
          <div className="ai-writing-summary">
            <div><Sparkles size={18} aria-hidden="true" /><span>{text(language, "已完成 / 参考", "Completed / reference")}</span><strong>{session.completedTurns}/{session.referenceTurns}</strong></div>
            <div><Check size={18} aria-hidden="true" /><span>{text(language, "预览节点", "Preview nodes")}</span><strong>{session.insertedCount}</strong></div>
            <div><LoaderCircle size={18} aria-hidden="true" /><span>{text(language, "当前视角", "Viewpoint")}</span><strong>{sceneName || "-"}</strong></div>
          </div>
          <p className={session.status === "failed" ? "ai-warning" : "ai-progress"}>{session.error || session.progress}</p>
          {session.contextNotice && <p className="ai-context-notice">{session.contextNotice}</p>}
          {session.validation && (
            <section className={`ai-validation-result ${session.validation.valid ? "valid" : "invalid"}`}>
              <div><strong>{text(language, session.validation.valid ? "生成前校验通过" : "生成前校验未通过", session.validation.valid ? "Preflight validation passed" : "Preflight validation failed")}</strong><p>{session.validation.summary}</p></div>
              {session.validation.issues.length > 0 && <ul>{session.validation.issues.map((issue, index) => (
                <li key={`${issue.scope}-${issue.targetId}-${index}`} data-severity={issue.severity}>
                  <strong>{issue.severity === "error" ? text(language, "阻断", "Error") : text(language, "建议", "Warning")} · {issue.targetId || issue.scope}</strong>
                  <span>{issue.message}</span>
                  <small>{issue.suggestion}</small>
                </li>
              ))}</ul>}
            </section>
          )}
          <div className="ai-writing-preview-list">
            {previewRows.length === 0 ? <div className="ai-empty-state">{text(language, "尚未生成可预览节点", "No preview nodes generated yet")}</div> : previewRows.map((row, index) => (
              <article className="ai-writing-preview-row" key={row.id || index}>
                <div><strong>{row.role || text(language, "旁白", "Narration")}</strong><small>{row.backPic || ""}</small></div>
                <p className={row.boxPos === "r" ? "dialogue right" : "dialogue"}>{row.content || ""}</p>
              </article>
            ))}
          </div>
        </div>
        <footer className="ai-modal-footer">
          <span className="ai-helper">{text(language, `已生成 ${session.insertedCount} 个节点，沉默 ${session.silentCount} 轮`, `${session.insertedCount} nodes generated, ${session.silentCount} silent turns`)}</span>
          <div>
            {running && <button type="button" onClick={onStop}>{text(language, "停止生成", "Stop generation")}</button>}
            {canRetry && <button type="button" onClick={onRetry}><RotateCcw size={15} aria-hidden="true" />{text(language, "从当前进度重试", "Retry from current progress")}</button>}
            <button type="button" onClick={onDiscard}><Trash2 size={15} aria-hidden="true" />{text(language, "丢弃", "Discard")}</button>
            <button type="button" className="ai-primary-button" onClick={onConfirm} disabled={!canConfirm}><Check size={15} aria-hidden="true" />{text(language, completed ? "确认写入" : "写入已生成部分", completed ? "Confirm and write" : "Write generated portion")}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function text(language: "zh" | "en", zh: string, en: string): string {
  return language === "en" ? en : zh;
}
