import { Bot, MapPin, Sparkles, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { AiProjectSettings, AiRuntimeState, AiWriteOptions } from "../ai/types";

export function AiWritingModal({
  settings,
  runtime,
  language,
  onClose,
  onStart,
}: {
  settings: AiProjectSettings;
  runtime: AiRuntimeState;
  language: "zh" | "en";
  onClose: () => void;
  onStart: (options: AiWriteOptions) => void;
}) {
  const initialSceneId = runtime.activeSceneId || settings.activeSceneId || settings.scenes[0]?.id || "";
  const [sceneId, setSceneId] = useState(initialSceneId);
  const [instruction, setInstruction] = useState("");
  const [turns, setTurns] = useState("3");
  const [error, setError] = useState("");
  const scene = settings.scenes.find((candidate) => candidate.id === sceneId);
  const participants = useMemo(() => settings.characters.filter((character) => runtime.characterSceneIds[character.id] === sceneId), [runtime.characterSceneIds, sceneId, settings.characters]);
  const eventCount = runtime.events.filter((event) => event.sceneId === sceneId).length;

  function generate() {
    const turnCount = Number(turns);
    if (!sceneId) {
      setError(text(language, "请选择场景", "Select a scene"));
      return;
    }
    if (!Number.isInteger(turnCount) || turnCount < 1) {
      setError(text(language, "请填写大于 0 的参考轮数", "Enter a reference turn count greater than 0"));
      return;
    }
    if (participants.length === 0) {
      setError(text(language, "当前场景没有在场角色", "The selected scene has no participants"));
      return;
    }
    setError("");
    onStart({ sceneId, instruction, turns: turnCount });
  }

  return (
    <div className="ai-modal-backdrop" role="presentation">
      <section className="ai-modal ai-writing-modal" role="dialog" aria-modal="true" aria-labelledby="ai-writing-title">
        <header className="ai-modal-header">
          <div>
            <span className="ai-modal-kicker"><Sparkles size={15} aria-hidden="true" /> AI</span>
            <h2 id="ai-writing-title">{text(language, "AI 编写", "AI Writing")}</h2>
            <p>{text(language, "上帝 AI 每轮分析场景、给各角色分配可见与可听信息，再选择角色行动并推进剧情。", "Each turn, the director analyzes the scene, assigns visible and audible information, selects an actor, and advances the plot.")}</p>
          </div>
          <button type="button" className="icon-button" title={text(language, "关闭", "Close")} onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </header>

        <div className="ai-writing-body">
          <div className="ai-writing-summary">
            <div><Bot size={18} aria-hidden="true" /><span>{text(language, "导演", "Director")}</span><strong>{settings.god.name || text(language, "上帝", "Director")}</strong></div>
            <div><MapPin size={18} aria-hidden="true" /><span>{text(language, "场景事件", "Scene events")}</span><strong>{eventCount}</strong></div>
            <div><Users size={18} aria-hidden="true" /><span>{text(language, "在场角色", "Participants")}</span><strong>{participants.length}</strong></div>
          </div>
          <div className="ai-form-grid">
            <label className="wide">{text(language, "起始场景", "Starting scene")}<select value={sceneId} onChange={(event) => setSceneId(event.target.value)}>{settings.scenes.map((item) => <option value={item.id} key={item.id}>{item.name || item.id}</option>)}</select></label>
            <label className="wide">{text(language, "本次导演要求", "Direction for this run")}<textarea rows={5} value={instruction} placeholder={text(language, "例如：让侦探试探管家，但不要立即揭露真相。", "Example: Have the detective test the butler without revealing the truth yet.")} onChange={(event) => setInstruction(event.target.value)} /></label>
            <label>{text(language, "参考轮数", "Reference turns")}<input type="number" min={1} step={1} value={turns} onChange={(event) => setTurns(event.target.value)} /></label>
            <div className="ai-participant-preview"><span>{text(language, "信息可见范围", "Visibility")}</span><p>{participants.map((participant) => participant?.name || participant?.id).join("、") || "-"}</p></div>
          </div>
          {scene && <div className="ai-scene-preview"><strong>{scene.name || scene.id}</strong><p>{scene.description || text(language, "未填写环境描述", "No scene description")}</p>{scene.opening && <small>{text(language, "开场：", "Opening: ")}{scene.opening}</small>}</div>}
          {error && <p className="ai-error">{error}</p>}
        </div>

        <footer className="ai-modal-footer">
          <span className="ai-helper">{text(language, "轮数用于规划本幕节奏；生成会持续到当前互动形成明确落点，不要求结束整部故事。角色可保持沉默、移动场景，上帝也可切换视角。", "Turns guide the pacing of this scene; generation continues until the current interaction reaches a clear closing beat, without requiring the whole story to end. Characters may remain silent or move, and the director may switch viewpoints.")}</span>
          <div><button type="button" onClick={onClose}>{text(language, "取消", "Cancel")}</button><button type="button" className="ai-primary-button" onClick={generate} disabled={!sceneId || turns === "" || !Number.isInteger(Number(turns)) || Number(turns) < 1}><Sparkles size={16} aria-hidden="true" />{text(language, "开始编写", "Start Writing")}</button></div>
        </footer>
      </section>
    </div>
  );
}

function text(language: "zh" | "en", zh: string, en: string): string {
  return language === "en" ? en : zh;
}
