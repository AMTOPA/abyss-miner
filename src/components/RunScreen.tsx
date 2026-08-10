"use client";

import { useEffect, useRef, useState } from "react";
import { ARCHETYPES } from "@/game/content";
import { fmt, fmtCombo, type SaveData } from "@/game/config";
import { MinerGame } from "@/game/engine";
import { AudioEngine } from "@/game/audio";
import type { AuthUser } from "@/lib/api";
import { CONSUMABLES, DIFFICULTY_DEFS, ORE_QUALITIES, RATING_INFO } from "@/game/items";
import type { BagSlot, ChallengeId, ModuleId, RevealLevel, RouteId, RunConfig, RunResult, UiSnapshot } from "@/game/types";
import BanditPanel from "./BanditPanel";
import BasePanel from "./BasePanel";
import BlackMarketPanel from "./BlackMarketPanel";
import BossPanel from "./BossPanel";
import ModulePanel from "./ModulePanel";
import RoomPanel from "./RoomPanel";
import RoutePanel from "./RoutePanel";
import Tip from "./Tip";

type Props = {
  save: SaveData;
  startDepth: number;
  runConfig: RunConfig;
  audio: AudioEngine;
  user: AuthUser | null;
  muted: boolean;
  submitState: "idle" | "submitting" | "done" | "needLogin" | "error";
  onToggleMute: () => void;
  onOpenAuth: (mode: "login" | "register") => void;
  onRunEnd: (result: RunResult) => void;
  onExit: () => void;
};

type DrillMode = "cautious" | "standard" | "overload";
type EngineHandle = {
  startRun(startDepth: number, save: SaveData, config: RunConfig): void;
  chooseMode(mode: DrillMode): void;
  drillStop(): void;
  drillRelease(): void;
  skipDrill(): void;
  useDetector(): void;
  useSupport(): void;
  useItem(slotKey: string): void;
  discardSlot(slotKey: string): void;
  retreat(): void;
  evacuate(special: boolean): void;
  emergencyRetreat(): void;
  creatureChoice(action: "scare" | "bait" | "force" | "retreat"): void;
  milkVein(): void;
  continueDescend(): void;
  anomalyContinue(): void;
  openBlackMarket(): void;
  bmSell(slotKey: string, count: number): void;
  bmBuy(index: number, pay: "cash" | "ore"): void;
  bmRepair(): void;
  bmRefresh(): void;
  bmClaimTask(taskId: string): void;
  bmLeave(): void;
  banditChoice(action: "pay" | "give" | "fight"): void;
  routeChoose(id: RouteId): void;
  roomChoose(optionId: string): void;
  chooseModule(moduleId: ModuleId): void;
  baseChoose(optionId: string): void;
  bossAction(actionId: string): void;
  destroy(): void;
};
type EngineCtor = new (canvas: HTMLCanvasElement, save: SaveData, audio: AudioEngine, cb: { onUi: (snap: UiSnapshot) => void; onRunEnd: (result: RunResult) => void }) => EngineHandle;

const MODE_INFO: Record<DrillMode, { name: string; desc: string; cls: string; icon: string }> = {
  cautious: { name: "稳妥钻进", desc: "低风险 · 可中途收手", cls: "btn-cautious", icon: "🛡️" },
  standard: { name: "标准钻进", desc: "均衡收益 · 可中途收手", cls: "btn-standard", icon: "⚙️" },
  overload: { name: "超载钻进", desc: "高收益 · 热量快速累积", cls: "btn-overload", icon: "🔥" },
};
const CHALLENGE_NAMES: Record<ChallengeId, string> = {
  no_checkpoint: "无检查点", no_blackmarket: "黑市封锁", limited_gear: "限制装备", abyssal_seed: "深渊种子",
};

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function widthPercent(value: number, max = 1): string { return `${clamp(value / Math.max(0.0001, max), 0, 1) * 100}%`; }
function displayPercent(value: number): string { return `${Math.round(Math.abs(value) <= 1 ? value * 100 : value)}%`; }
// 并行开发期兼容旧快照中的布尔 revealed。
function normalizeReveal(value: unknown): RevealLevel {
  if (value === "full" || value === true) return "full";
  return value === "basic" ? "basic" : "none";
}
// 并行开发期兼容旧快照中的布尔 retreatBlocked。
function remainingLayers(value: unknown): number {
  if (typeof value === "number") return Math.max(0, Math.ceil(value));
  return value ? 1 : 0;
}

function BagGrid(props: { slots: BagSlot[]; used: number; total: number; onUse?: (key: string) => void; onDiscard?: (key: string) => void }) {
  const emptyCount = Math.max(0, props.total - props.used);
  return (
    <div className="bag-grid">
      {props.slots.map((slot) => {
        if (slot.kind === "ore" && slot.quality) {
          const quality = ORE_QUALITIES[slot.quality];
          return (
            <Tip key={slot.key} label={<><strong>{quality.name}</strong> · 单价 {fmt(slot.unitValue)} · 共 {fmt(slot.value)}{slot.danger ? <span className="tip-sub">⚠️ 携带风险 +{displayPercent(slot.danger)}</span> : null}</>}><div className="bag-cell bag-cell-ore" style={{ borderColor: slot.color }}>
              <span className="bag-icon">{quality.icon}</span><span className="bag-name">{slot.name}</span>
              <span className="bag-quality" style={{ color: quality.color }}>{quality.name}</span><span className="bag-qty">×{slot.count}</span><span className="bag-value">{fmt(slot.value)}</span>
              {!!slot.danger && <span className="bag-danger">风险 +{displayPercent(slot.danger)}</span>}
              {props.onDiscard && <button type="button" className="bag-discard" onClick={() => props.onDiscard?.(slot.key)}>丢弃</button>}
            </div></Tip>
          );
        }
        return (
          <Tip key={slot.key} label={<>{CONSUMABLES[slot.id]?.desc ?? "局内消耗品，可在对应阶段使用"}</>}><div className="bag-cell bag-cell-item" style={{ borderColor: slot.color }}>
            <span className="bag-icon">{slot.icon ?? "📦"}</span><span className="bag-name">{slot.name}</span><span className="bag-qty">×{slot.count}</span>
            {props.onUse && <button type="button" className="bag-use" onClick={() => props.onUse?.(slot.key)}>使用</button>}
            {props.onDiscard && <button type="button" className="bag-discard" onClick={() => props.onDiscard?.(slot.key)}>丢弃</button>}
          </div></Tip>
        );
      })}
      {Array.from({ length: emptyCount }, (_, index) => <div key={`empty-${index}`} className="bag-cell bag-cell-empty" />)}
    </div>
  );
}

function SyncingPanel({ title }: { title: string }) {
  return <div className="panel v4-stage-panel stage-syncing-panel"><h2 className="stage-panel-title">{title}</h2><p className="modal-hint">引擎正在同步本阶段数据…</p></div>;
}

export default function RunScreen(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<EngineHandle | null>(null);
  const [snap, setSnap] = useState<UiSnapshot | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const current = propsRef.current;
    current.audio.init();
    current.audio.play("ambient");
    const Ctor = MinerGame as unknown as EngineCtor;
    const engine = new Ctor(canvas, current.save, current.audio, { onUi: setSnap, onRunEnd: (result) => propsRef.current.onRunEnd(result) });
    engineRef.current = engine;
    engine.startRun(current.startDepth, current.save, current.runConfig);
    return () => { engine.destroy(); engineRef.current = null; };
  }, []);

  // v7：远征进行中拦截误刷新/关闭，避免无提示丢失本局（已扣除的出发资源不会返还）
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!engineRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const act = (fn: (engine: EngineHandle) => void) => {
    const engine = engineRef.current;
    if (!engine) return;
    props.audio.play("click");
    fn(engine);
  };
  const exit = () => {
    if (!window.confirm("放弃本次下矿？未入库的矿石将丢失。")) return;
    engineRef.current?.destroy();
    props.onExit();
  };

  const retreatBlocked = remainingLayers(snap?.retreatBlocked);
  const cautiousCooldown = remainingLayers(snap?.cautiousCooldown);
  const revealLevel = normalizeReveal(snap?.revealLevel ?? snap?.layer?.revealed);
  const archetypeId = snap?.archetype ?? props.runConfig.archetype;
  const archetype = archetypeId ? ARCHETYPES[archetypeId] : null;
  const activeChallenges = snap?.challenge ?? props.runConfig.challenge ?? [];
  const drillingHeat = snap?.drilling && Number.isFinite(snap.drilling.heat) ? snap.drilling.heat : snap?.overheat ?? 0;

  return (
    <div className="run-screen">
      <canvas ref={canvasRef} className="run-canvas" />
      <header className="run-topbar">
        <div className="topbar-controls"><button type="button" className="btn btn-ghost btn-sm" onClick={exit}>✕ 返回</button><button type="button" className="btn btn-ghost btn-sm" onClick={props.onToggleMute}>{props.muted ? "🔇" : "🔊"}</button></div>
        {snap && <div className="topbar-status">
          <span className="topbar-depth">{snap.depth}m · {snap.stageName}</span>
          <span className="diff-badge" style={{ color: DIFFICULTY_DEFS[snap.difficulty].color, borderColor: DIFFICULTY_DEFS[snap.difficulty].color }}>{DIFFICULTY_DEFS[snap.difficulty].icon} {DIFFICULTY_DEFS[snap.difficulty].name}</span>
          <span className="archetype-badge" style={archetype ? { color: archetype.color, borderColor: archetype.color } : undefined}>{archetype ? `${archetype.icon} ${archetype.name}` : "⛏️ 自由矿工"}</span>
          <span className="pocket-chip">🪙 {fmt(snap.pocket)}</span>
          <span className="topbar-bars">
            <span className="mini-bar" title={`耐久 ${Math.round(snap.durability)}/${Math.round(snap.maxDurability)}`}><span className="mini-bar-label">耐久</span><span className="mini-bar-track"><span className="mini-bar-fill durability-fill" style={{ width: widthPercent(snap.durability, snap.maxDurability) }} /></span></span>
            <span className="mini-bar" title={`电量 ${Math.round(snap.power)}/${Math.round(snap.maxPower)}`}><span className="mini-bar-label">电量</span><span className="mini-bar-track"><span className="mini-bar-fill power-fill" style={{ width: widthPercent(snap.power, snap.maxPower) }} /></span></span>
            <span className="mini-bar" title={`热量 ${Math.round(snap.overheat)}/100`}><span className="mini-bar-label">热量</span><span className="mini-bar-track"><span className={`mini-bar-fill heat-fill ${snap.overheat >= 80 ? "critical" : ""}`} style={{ width: widthPercent(snap.overheat, 100) }} /></span></span>
          </span>
          {snap.wearPenalty > 0 && <span className="wear-warning">⚠️ 损耗 -{displayPercent(snap.wearPenalty)}</span>}
          <span className="topbar-bag-summary">🎒 {snap.usedSlots}/{snap.slots} · {fmt(snap.load)}</span>
          {snap.disasterGuard > 0 && <span className="topbar-bag-summary guard-chip" title="应急锚点生效中：灾难事故将降级为严重事故，剩余保护距离">⚓ 锚点保护 {snap.disasterGuard * 10}m</span>}
          {activeChallenges.length > 0 && <span className="challenge-summary" title={activeChallenges.map((id) => CHALLENGE_NAMES[id]).join("、")}>词缀 ×{activeChallenges.length}</span>}
        </div>}
      </header>

      {snap && (snap.phase === "descending" || snap.phase === "idle") && <div className="run-overlay center-tip"><div className="drilling-tip"><span className="drilling-spin">⬇</span><span>下潜中…</span></div></div>}

      {snap?.phase === "observe" && snap.layer && <div className="run-overlay run-drawer"><div className="observe-layout">
        <div className="panel info-panel reveal-panel">
          <div className="panel-title"><span className="layer-depth">第 {Math.floor(snap.depth / 10) + 1} 层</span> · {snap.depth}m · {snap.stageName}</div>
          <div className={`reveal-level reveal-note reveal-${revealLevel}`}>情报等级：{revealLevel === "full" ? "完全揭示" : revealLevel === "basic" ? "基础判读" : "信号模糊"}</div>
          <div className="layer-chips">
            <span className={`chip ${revealLevel !== "full" ? "chip-blurred" : ""}`}>岩质：{revealLevel === "full" ? snap.layer.hardnessText : "???"}</span>
            <span className={`chip chip-quality ${revealLevel !== "full" ? "chip-blurred" : ""}`}>矿脉：{revealLevel === "full" ? snap.layer.qualityText : "???"}</span>
            <span className={`chip chip-danger ${revealLevel === "none" ? "chip-blurred" : ""}`}>危险：{revealLevel === "none" ? "???" : snap.layer.hazardText ?? "暂未发现"}</span>
            <span className={`chip ${revealLevel === "none" ? "chip-blurred" : ""}`}>塌方：{revealLevel === "none" ? "???" : snap.layer.collapseRiskLabel}</span>
          </div>
          {snap.riskRange && revealLevel !== "none" && <div className="risk-range-card risk-pill" style={{ borderColor: snap.riskRange.color }}><span className="risk-range-label" style={{ color: snap.riskRange.color }}>{snap.riskRange.label}</span><strong>{displayPercent(snap.riskRange.min)} — {displayPercent(snap.riskRange.max)}</strong></div>}
          {snap.disasterMode === "gauge" && <div className="disaster-gauge-card"><div className="disaster-gauge-head"><span>🌡️ 灾难累计值</span><strong className={snap.disasterGauge >= 80 ? "gauge-danger" : snap.disasterGauge >= 55 ? "gauge-warn" : ""}>{snap.disasterGauge}/100</strong></div><div className="disaster-gauge-bar"><div className={`disaster-gauge-fill ${snap.disasterGauge >= 80 ? "danger" : snap.disasterGauge >= 55 ? "warn" : ""}`} style={{ width: `${Math.min(100, snap.disasterGauge)}%` }} /></div><span className="disaster-gauge-hint">满 100 触发灾难 · 可使用「岩压稳定剂」-30</span></div>}
          <ul className="signal-list">{snap.layer.signals.map((signal, index) => <li key={`${signal}-${index}`} className={signal.startsWith("[预知]") ? "signal preview" : "signal"}>{signal.startsWith("[预知]") ? "🔮 " : "▸ "}{signal}</li>)}</ul>
          {revealLevel === "full" && <div className="revealed-note">📡 精确信息已完全揭示</div>}
          {snap.layer.anomalyEffect && <div className="anomaly-effect-note">🌀 {snap.layer.anomalyEffect}</div>}
        </div>

        {snap.evac && <div className="panel evac-panel">
          <div className="panel-title">🏠 撤离评估</div>
          <div className="evac-value-grid"><div className="evac-stat"><span>现在撤离可保全</span><strong>{fmt(snap.evac.saveNow)}</strong></div><div className="evac-stat danger"><span>预计灾难损失</span><strong>{fmt(snap.evac.expectedLossValue)} · {displayPercent(snap.evac.expectedLossPct)}</strong></div></div>
          {snap.evac.nextMilestone && <div className="evac-milestone">下一里程碑：{snap.evac.nextMilestone.depth}m · {snap.evac.nextMilestone.name}</div>}
          {snap.evac.taskSummary.length > 0 && <ul className="evac-task-list">{snap.evac.taskSummary.map((task) => <li key={task}>{task}</li>)}</ul>}
          {snap.evac.bagDanger > 0 && <div className="bag-risk-warning">🎒 背包附加风险 +{displayPercent(snap.evac.bagDanger)}</div>}
          {retreatBlocked > 0 && <div className="retreat-blocked-note">🚫 常规撤离封锁：剩余 {retreatBlocked} 层</div>}
        </div>}

        {(snap.layer.nodePreview ?? []).length > 0 && <div className="panel node-preview-panel"><div className="panel-title">🧭 下一节点预览</div><div className="node-preview-list">{(snap.layer.nodePreview ?? []).map((node, index) => <div key={`${node.name}-${index}`} className="node-preview-card"><strong>{node.name}</strong><span>{node.riskLabel}</span><span>{node.rewardLabel}</span></div>)}</div></div>}

        <div className="action-dock panel mobile-action-bar">
          <div className="dock-row mode-button-row mode-dock">{(Object.keys(MODE_INFO) as DrillMode[]).map((mode) => {
            const cooling = mode === "cautious" && cautiousCooldown > 0;
            return <button key={mode} type="button" className={`btn drill-btn ${MODE_INFO[mode].cls}`} disabled={!snap.canDrill || cooling} onClick={() => act((engine) => engine.chooseMode(mode))}><span className="drill-icon">{MODE_INFO[mode].icon}</span><span className="drill-name">{MODE_INFO[mode].name}</span><span className="drill-desc">{cooling ? `冷却剩余 ${cautiousCooldown} 层` : MODE_INFO[mode].desc}</span>{mode === "overload" && <span className={`overload-risk ${snap.overheat >= 70 ? "hot" : ""}`}>当前热量 {Math.round(snap.overheat)}% · 高热增险</span>}</button>;
          })}</div>
          {retreatBlocked > 0 && <div className="retreat-status-note">🚫 常规撤离封锁，剩余 {retreatBlocked} 层；仅可尝试紧急撤退。</div>}
          <div className="dock-row dock-secondary"><button type="button" className="btn btn-ghost" disabled={snap.detectors <= 0} onClick={() => act((engine) => engine.useDetector())}>📡 探测器 ×{snap.detectors}</button><button type="button" className="btn btn-ghost" disabled={snap.supports <= 0} onClick={() => act((engine) => engine.useSupport())}>🪨 支撑架 ×{snap.supports}</button>{snap.evacPoint ? <><button type="button" className="btn btn-success" onClick={() => act((engine) => engine.evacuate(false))}>🚁 撤离点撤离</button>{snap.evacPoint.special && <button type="button" className="btn btn-special-evac" onClick={() => act((engine) => engine.evacuate(true))}>🛩️ 特殊撤离 {fmt(snap.evacPoint.cost)}💰</button>}</> : <span className="no-evac-hint">⚠️ 当前非撤离点 · 需继续下潜至撤离点才能撤离</span>}</div>
        </div>

        <div className="panel bag-panel"><div className="panel-title">🎒 背包 {snap.usedSlots}/{snap.slots} 格 · 总价值 {fmt(snap.load)}</div><BagGrid slots={snap.bag} used={snap.usedSlots} total={snap.slots} onUse={(key) => act((engine) => engine.useItem(key))} onDiscard={(key) => act((engine) => engine.discardSlot(key))} /></div>
      </div></div>}

      {snap?.phase === "drilling" && snap.drilling && <div className="run-overlay center-tip drilling-overlay"><div className={`drilling-tip drilling-console mode-${snap.drilling.mode}`}>
        <div className="drilling-title"><span className="drilling-spin">⛏️</span><strong>{MODE_INFO[snap.drilling.mode].name}中…</strong><span>岩层硬度 {snap.drilling.hardness.toFixed(1)}</span></div>
        <div className="drilling-meter"><span className="drilling-meter-label">钻进进度 {Math.round(snap.drilling.progress * 100)}%</span><span className="drill-progress"><span className="drill-progress-fill" style={{ width: widthPercent(snap.drilling.progress) }} /></span></div>
        {snap.drilling.mode === "overload" && <div className={`drilling-meter heat-meter heat-bar ${drillingHeat >= 85 ? "danger" : ""}`}><span className="drilling-meter-label">热量 {Math.round(drillingHeat)}%</span><span className="heat-progress heat-track"><span className="heat-progress-fill heat-fill" style={{ width: widthPercent(drillingHeat, 100) }} /></span>{drillingHeat >= 85 && <span className="heat-critical-warning">⚠️ 临界过热，立即释放热量！</span>}</div>}
        <div className="drilling-controls">{snap.drilling.mode === "overload" ? <button type="button" className="btn btn-overload release-btn" disabled={snap.drilling.canStop === false} onClick={() => act((engine) => engine.drillRelease())}>🌬️ 释放热量</button> : <button type="button" className="btn btn-secondary stop-drill-btn" disabled={snap.drilling.canStop === false} onClick={() => act((engine) => engine.drillStop())}>✋ 中途收手</button>}<button type="button" className="btn btn-ghost btn-sm skip-btn" onClick={() => act((engine) => engine.skipDrill())}>跳过 ⏭</button></div>
      </div></div>}

      {snap?.phase === "route" && <div className="run-overlay stage-overlay">{snap.routes ? <RoutePanel routes={snap.routes} onChoose={(id) => act((engine) => engine.routeChoose(id))} /> : <SyncingPanel title="正在读取路线" />}</div>}
      {snap?.phase === "room" && <div className="run-overlay stage-overlay">{snap.room ? <RoomPanel room={snap.room} onChoose={(id) => act((engine) => engine.roomChoose(id))} /> : <SyncingPanel title="正在进入房间" />}</div>}
      {snap?.phase === "module" && <div className="run-overlay stage-overlay">{snap.moduleChoice ? <ModulePanel modules={snap.moduleChoice} onChoose={(id) => act((engine) => engine.chooseModule(id))} /> : <SyncingPanel title="正在生成模块" />}</div>}
      {snap?.phase === "base" && <div className="run-overlay stage-overlay">{snap.base ? <BasePanel base={snap.base} onChoose={(id) => act((engine) => engine.baseChoose(id))} /> : <SyncingPanel title="正在接入营地" />}</div>}
      {snap?.phase === "boss" && <div className="run-overlay stage-overlay">{snap.boss ? <BossPanel boss={snap.boss} onAction={(id) => act((engine) => engine.bossAction(id))} /> : <SyncingPanel title="威胁正在逼近" />}</div>}

      {snap?.phase === "result" && snap.result && <div className="run-overlay run-drawer"><div className="panel result-panel">
        <div className="result-value"><span className="result-label">本次收益</span><span className="result-amount gold">+{fmt(snap.result.value)}</span><span className="result-combo">Combo {snap.result.comboDelta > 0 ? `+${snap.result.comboDelta.toFixed(2)}` : ""} → {fmtCombo(snap.combo)}</span></div>
        {snap.disasterMode === "gauge" && <div className="disaster-gauge-card compact"><div className="disaster-gauge-head"><span>🌡️ 灾难累计值</span><strong className={snap.disasterGauge >= 80 ? "gauge-danger" : snap.disasterGauge >= 55 ? "gauge-warn" : ""}>{snap.disasterGauge}/100</strong></div><div className="disaster-gauge-bar"><div className={`disaster-gauge-fill ${snap.disasterGauge >= 80 ? "danger" : snap.disasterGauge >= 55 ? "warn" : ""}`} style={{ width: `${Math.min(100, snap.disasterGauge)}%` }} /></div></div>}
        {snap.result.layers > 1 && <div className="penetrate-badge" data-testid="penetrate-badge">⚡ 穿透 ×{snap.result.layers} 层！一次钻进 {snap.result.layers * 10}m</div>}
        {snap.result.droppedItem && <div className="dropped-item">💥 拾取道具：{snap.result.droppedItem.icon} {snap.result.droppedItem.name}</div>}
        {snap.result.events.length > 0 && <ul className="event-list">{snap.result.events.map((event, index) => <li key={`${event}-${index}`} className={event.includes("损失") || event.includes("过热") ? "event bad" : "event good"}>{event}</li>)}</ul>}
        <div className="bag-total">背包 {snap.usedSlots}/{snap.slots} 格 · 总价值 {fmt(snap.load)}</div><BagGrid slots={snap.bag} used={snap.usedSlots} total={snap.slots} onUse={(key) => act((engine) => engine.useItem(key))} onDiscard={(key) => act((engine) => engine.discardSlot(key))} />
        <div className="bag-tools"><button type="button" className="btn btn-ghost btn-sm" disabled={!snap.bag.some((slot) => slot.kind === "ore")} onClick={() => { const lowest = snap.bag.filter((slot) => slot.kind === "ore").sort((a, b) => a.value - b.value)[0]; if (lowest) act((engine) => engine.discardSlot(lowest.key)); }}>🗑 丢弃最低价值</button></div>
        <div className="modal-actions result-actions">{snap.result.canMilk && snap.result.milkRewardMult != null && <button type="button" className="btn btn-milk" onClick={() => act((engine) => engine.milkVein())}>💎 榨取矿脉 ×{snap.result.milkRewardMult}</button>}{snap.result.canBlackMarket && <button type="button" className="btn btn-secondary" onClick={() => act((engine) => engine.openBlackMarket())}>🚪 前往黑市</button>}<button type="button" className="btn btn-primary" onClick={() => act((engine) => engine.continueDescend())}>⬇ 继续深入</button>{snap.evacPoint ? <><button type="button" className="btn btn-success" onClick={() => act((engine) => engine.evacuate(false))}>🚁 撤离点撤离</button>{snap.evacPoint.special && <button type="button" className="btn btn-special-evac" onClick={() => act((engine) => engine.evacuate(true))}>🛩️ 特殊撤离 {fmt(snap.evacPoint.cost)}💰</button>}</> : <span className="no-evac-hint">⚠️ 当前非撤离点 · 需继续下潜至撤离点才能撤离</span>}</div>
      </div></div>}

      {snap?.phase === "hazard" && snap.hazard && <div className="run-overlay stage-overlay"><div className="panel hazard-panel"><div className="panel-title danger-text">👾 地底生物挡住了去路！</div><p className="modal-hint">危险等级：{"◆".repeat(snap.hazard.severity)}</p><div className="hazard-actions"><button type="button" className="btn btn-secondary" onClick={() => act((engine) => engine.creatureChoice("scare"))}>⚡ 驱赶（耗电耗耐久）</button><button type="button" className="btn btn-secondary" onClick={() => act((engine) => engine.creatureChoice("bait"))}>🥩 丢矿石诱饵</button><button type="button" className="btn btn-overload" onClick={() => act((engine) => engine.creatureChoice("force"))}>💪 强行突破</button></div></div></div>}
      {snap?.phase === "anomaly" && snap.anomaly && <div className="run-overlay stage-overlay"><div className="panel anomaly-panel"><div className="panel-title abyss-text">🌀 深渊异常</div><p className="anomaly-text">{snap.anomaly.text}</p><div className="modal-actions"><button type="button" className="btn btn-primary" onClick={() => act((engine) => engine.anomalyContinue())}>踏入这一层</button></div></div></div>}
      {snap?.phase === "bandit" && snap.bandit && <BanditPanel severity={snap.bandit.severity} pocket={snap.bandit.pocket} onChoice={(action) => act((engine) => engine.banditChoice(action))} />}
      {snap?.phase === "blackmarket" && snap.blackmarket && <BlackMarketPanel view={snap.blackmarket} onSell={(key, count) => act((engine) => engine.bmSell(key, count))} onBuy={(index, payment) => act((engine) => engine.bmBuy(index, payment))} onRefresh={() => act((engine) => engine.bmRefresh())} onRepair={() => act((engine) => engine.bmRepair())} onClaim={(taskId) => act((engine) => engine.bmClaimTask(taskId))} onLeave={() => act((engine) => engine.bmLeave())} />}

      {snap?.phase === "gameover" && snap.gameover && <div className="run-overlay end-overlay"><div className="panel end-panel disaster"><h2 className="end-title">💥 灾难事故！</h2><p className="modal-hint">{snap.gameover.reason || "钻机损毁，本次下矿被迫终止。救援队帮你带回了部分矿石。"}</p><div className="end-stats"><div className="stat-card"><span className="stat-label">抵达深度</span><span className="stat-value">{snap.gameover.depth}m</span></div><div className="stat-card"><span className="stat-label">救援带回</span><span className="stat-value gold">+{fmt(snap.gameover.saved)}</span></div>{snap.gameover.pocketLost > 0 && <div className="stat-card"><span className="stat-label">随身现金损失</span><span className="stat-value danger-text">-{fmt(snap.gameover.pocketLost)}</span></div>}{snap.gameover.best && <div className="stat-card"><span className="stat-label">抵达最深</span><span className="stat-value cyan">新纪录！</span></div>}</div><div className="modal-actions"><button type="button" className="btn btn-primary" onClick={props.onExit}>返回主菜单</button></div></div></div>}

      {snap?.phase === "surfaced" && snap.surfaced && <div className="run-overlay end-overlay"><div className="panel end-panel success"><h2 className="end-title success-title">🏠 安全返回地面！</h2><p className="modal-hint">矿石与随身现金已全部入库。</p>{snap.surfaced.rating && <div className={`rating-badge rating-${snap.surfaced.rating}`} style={{ color: RATING_INFO[snap.surfaced.rating].color, borderColor: RATING_INFO[snap.surfaced.rating].color }}>{snap.surfaced.rating} · {RATING_INFO[snap.surfaced.rating].name}</div>}<div className="end-stats"><div className="stat-card"><span className="stat-label">本次入库</span><span className="stat-value gold">+{fmt(snap.surfaced.banked)}</span></div><div className="stat-card"><span className="stat-label">最深深度</span><span className="stat-value cyan">{snap.surfaced.depth}m</span></div>{snap.surfaced.bonusCash > 0 && <div className="stat-card"><span className="stat-label">评级奖励</span><span className="stat-value gold">+{fmt(snap.surfaced.bonusCash)}</span></div>}{snap.surfaced.pocketReturn > 0 && <div className="stat-card"><span className="stat-label">随身现金归还</span><span className="stat-value">+{fmt(snap.surfaced.pocketReturn)}</span></div>}<div className="stat-card"><span className="stat-label">累计现金</span><span className="stat-value purple">{fmt(snap.surfaced.totalBanked)}</span></div></div>{snap.surfaced.best && <p className="modal-hint new-best">🏅 新纪录！</p>}<div className="submit-area">{props.submitState === "submitting" && <span className="submit-note">成绩提交中…</span>}{props.submitState === "done" && <span className="submit-note ok">🏆 成绩已上榜！</span>}{props.submitState === "error" && <span className="submit-note bad">成绩提交失败</span>}{props.submitState === "needLogin" && <button type="button" className="btn btn-primary" onClick={() => props.onOpenAuth("login")}>🔑 登录后上榜</button>}</div><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={props.onExit}>返回主菜单</button></div></div></div>}

      <style jsx global>{`
        .run-topbar{max-width:calc(100vw - 28px);flex-wrap:wrap;justify-content:flex-end}.topbar-controls,.topbar-status,.topbar-bars,.mini-bar{display:flex;align-items:center;gap:6px}.topbar-status{flex-wrap:wrap;justify-content:flex-end}.route-card-grid,.module-card-grid,.base-option-grid,.room-option-list{grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.stage-panel-heading,.stage-panel-desc,.room-visited-note,.base-status-badge{grid-column:1/-1}.boss-action-list{display:grid;gap:10px}.mini-bar-track{display:inline-block;width:64px;height:8px;overflow:hidden;vertical-align:middle;border-radius:4px;background:rgba(255,255,255,.16)}.mini-bar-fill{display:block;height:100%;transition:width .15s linear}.durability-fill{background:#e08a45}.power-fill{background:#ffd166}.heat-fill{background:#ff8c42}.heat-fill.critical{background:#ff493d;box-shadow:0 0 8px #ff493d}.stage-overlay{display:flex;align-items:center;justify-content:center;padding:72px 16px 24px;overflow-y:auto}.v4-stage-panel{width:min(860px,94vw);max-height:calc(100dvh - 110px);overflow-y:auto;padding:22px}
        @media(max-width:600px){.run-topbar{left:8px;right:8px;top:8px;display:block;max-height:96px;overflow-x:auto}.topbar-controls,.topbar-status{display:flex;align-items:center;gap:6px;min-width:max-content}.topbar-status{margin-top:6px}.topbar-bars,.challenge-summary{display:none}.run-drawer{overflow-y:auto;padding:104px 8px 12px}.observe-layout{position:static;display:flex;flex-direction:column;align-items:stretch;padding:0 0 170px;flex-wrap:nowrap}.info-panel,.evac-panel,.node-preview-panel,.bag-panel,.action-dock{width:100%;max-width:none}.mobile-action-bar{position:fixed;left:8px;right:8px;bottom:8px;z-index:40;max-height:146px;overflow-y:auto;padding:8px}.mode-button-row{gap:5px}.drill-btn{min-height:68px;padding:7px 4px}.drill-icon{font-size:17px}.drill-name{font-size:12px}.drill-desc,.overload-risk{font-size:9px}.dock-secondary{overflow-x:auto;justify-content:flex-start;padding-bottom:2px}.dock-secondary .btn{min-width:112px}.stage-overlay{align-items:flex-start;padding:106px 8px 12px}.v4-stage-panel{width:100%;max-height:calc(100dvh - 118px);padding:16px 12px}.drilling-overlay{align-items:flex-end;padding:8px 8px 20px}.drilling-console{width:100%;max-height:62dvh;overflow-y:auto;display:flex;flex-direction:column;align-items:stretch;border-radius:16px}.drilling-controls{position:sticky;bottom:0;display:flex;gap:8px;padding-top:8px;background:rgba(24,17,10,.92)}.result-panel{position:static;transform:none;width:100%;max-height:calc(100dvh - 118px);overflow-y:auto;margin:0}.run-drawer>.result-panel{margin-top:0}}
      `}</style>
    </div>
  );
}
