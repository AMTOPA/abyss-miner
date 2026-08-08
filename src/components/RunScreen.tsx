"use client";

import { useEffect, useRef, useState } from "react";
import { ORES, SaveData, fmt, fmtCombo } from "@/game/config";
import { DrillMode, MinerGame, RunResult, UiSnapshot } from "@/game/engine";
import { AudioEngine } from "@/game/audio";
import { AuthUser } from "@/lib/api";

type Props = {
  save: SaveData;
  startDepth: number;
  audio: AudioEngine;
  user: AuthUser | null;
  muted: boolean;
  submitState: "idle" | "submitting" | "done" | "needLogin" | "error";
  onToggleMute: () => void;
  onOpenAuth: (mode: "login" | "register") => void;
  onRunEnd: (result: RunResult) => void;
  onExit: () => void;
};

const MODE_INFO: Record<DrillMode, { name: string; desc: string; cls: string; icon: string }> = {
  cautious: { name: "稳妥钻进", desc: "收益 ×0.75 · 风险 ×0.55 · 低概率穿透", cls: "btn-cautious", icon: "🛡️" },
  standard: { name: "标准钻进", desc: "收益 ×1.00 · 风险 ×1.00 · 有概率穿透", cls: "btn-standard", icon: "⚙️" },
  overload: { name: "超载钻进", desc: "收益 ×1.70+ · 风险 ×1.65 · 高概率穿透多层", cls: "btn-overload", icon: "🔥" },
};

export default function RunScreen(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<MinerGame | null>(null);
  const [snap, setSnap] = useState<UiSnapshot | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const audio = propsRef.current.audio;
    audio.init();
    audio.play("ambient");
    const engine = new MinerGame(
      canvas,
      propsRef.current.save,
      audio,
      {
        onUi: (s) => setSnap(s),
        onRunEnd: (r) => propsRef.current.onRunEnd(r),
      }
    );
    engineRef.current = engine;
    engine.startRun(propsRef.current.startDepth, propsRef.current.save);
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = (fn: (g: MinerGame) => void) => {
    const g = engineRef.current;
    if (!g) return;
    props.audio.play("click");
    fn(g);
  };

  const exit = () => {
    if (window.confirm("放弃本次下矿？未入库的矿石将丢失。")) {
      engineRef.current?.destroy();
      props.onExit();
    }
  };

  return (
    <div className="run-screen">
      <canvas ref={canvasRef} className="run-canvas" />

      <div className="run-topbar">
        <button className="btn btn-ghost btn-sm" onClick={exit}>
          ✕ 返回
        </button>
        <button className="btn btn-ghost btn-sm" onClick={props.onToggleMute}>
          {props.muted ? "🔇" : "🔊"}
        </button>
      </div>

      {snap && snap.phase === "observe" && snap.layer && (
        <div className="run-overlay">
          <div className="observe-layout">
            <div className="panel info-panel">
              <div className="panel-title"><span className="layer-depth">第 {Math.floor(snap.depth / 10) + 1} 层</span> · {snap.depth}m · {snap.stageName}</div>
              <div className="layer-chips">
                <span className="chip">岩质：{snap.layer.hardnessText}</span>
                <span className="chip chip-quality">矿脉：{snap.layer.qualityText}</span>
                {snap.layer.hazardText && <span className="chip chip-danger">危险：{snap.layer.hazardText}</span>}
                <span className="chip">塌方风险：{snap.layer.collapseRiskLabel}</span>
              </div>
              <ul className="signal-list">
                {snap.layer.signals.map((s, i) => (
                  <li key={i} className={s.startsWith("[预知]") ? "signal preview" : "signal"}>
                    {s.startsWith("[预知]") ? "🔮 " : "▸ "}
                    {s}
                  </li>
                ))}
              </ul>
              {snap.layer.revealed && <div className="revealed-note">📡 探测器已揭示精确信息</div>}
            </div>

            <div className="action-dock panel">
              <div className="dock-row">
                {(Object.keys(MODE_INFO) as DrillMode[]).map((m) => (
                  <button
                    key={m}
                    className={`btn drill-btn ${MODE_INFO[m].cls}`}
                    disabled={!snap.canDrill}
                    onClick={() => act((g) => g.chooseMode(m))}
                  >
                    <span className="drill-icon">{MODE_INFO[m].icon}</span>
                    <span className="drill-name">{MODE_INFO[m].name}</span>
                    <span className="drill-desc">{MODE_INFO[m].desc}</span>
                  </button>
                ))}
              </div>
              <div className="dock-row dock-secondary">
                <button className="btn btn-ghost" disabled={snap.detectors <= 0} onClick={() => act((g) => g.useDetector())}>
                  📡 探测器 ×{snap.detectors}
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={snap.supports <= 0}
                  onClick={() => act((g) => g.useSupport())}
                >
                  🪨 支撑架 ×{snap.supports}
                </button>
                <button
                  className="btn btn-danger"
                  disabled={snap.retreatBlocked}
                  onClick={() => act((g) => g.retreat())}
                >
                  🏠 返回地面
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {snap && snap.phase === "drilling" && snap.drilling && (
        <div className="run-overlay center-tip">
          <div className="drilling-tip">
            <span className="drilling-spin">⛏️</span>
            <span>{MODE_INFO[snap.drilling.mode].name}中…</span>
          
          <span className="drill-progress"><span className="drill-progress-fill" style={{ width: `${Math.round((snap.drilling.progress ?? 0) * 100)}%` }} /></span>
          <button className="btn btn-ghost btn-sm skip-btn" onClick={() => act((g) => g.skipDrill())}>跳过 ⏭</button></div>
        </div>
      )}

      {snap && snap.phase === "result" && snap.result && (
        <div className="run-overlay">
          <div className="panel result-panel">
            <div className="result-value">
              <span className="result-label">本次收益</span>
              <span className="result-amount gold">+{fmt(snap.result.value)}</span>
              <span className="result-combo">Combo {snap.result.comboDelta > 0 ? `+${snap.result.comboDelta.toFixed(2)}` : ""} → {fmtCombo(snap.combo)}</span>
            </div>
            {snap.result.layers > 1 && (
              <div
                data-testid="penetrate-badge"
                style={{
                  marginBottom: 10, textAlign: "center", fontSize: 18, fontWeight: 900,
                  color: "#ffc857", textShadow: "0 0 16px rgba(255,200,87,0.6)",
                }}
              >
                ⚡ 穿透 ×{snap.result.layers} 层！一次钻进 {snap.result.layers * 10}m
              </div>
            )}
            {snap.result.events.length > 0 && (
              <ul className="event-list">
                {snap.result.events.map((e, i) => (
                  <li key={i} className={e.includes("损失") || e.includes("过热") ? "event bad" : "event good"}>
                    {e}
                  </li>
                ))}
              </ul>
            )}
            <div className="bag-preview">
              {snap.backpack.slice(0, 7).map((b) => (
                <span key={b.id} className="bag-chip" style={{ borderColor: b.color, color: b.color }}>
                  <span className="ore-dot" style={{ background: b.color, boxShadow: `0 0 8px ${b.color}` }} />
                  {b.name} ×{b.count}
                  <button className="bag-discard" title={`丢弃 ${b.name}`} onClick={() => act((g) => g.discardOre(b.id))}>✕</button>
                </span>
              ))}
              {snap.backpack.length > 7 && <span className="bag-chip">+{snap.backpack.length - 7}</span>}
              <span className="bag-total">背包 {fmt(snap.load)} / {fmt(snap.capacity)}</span>
            </div>
            <div className="bag-tools">
              <button className="btn btn-ghost btn-sm" disabled={snap.backpack.length === 0} onClick={() => act((g) => g.discardLowest())}>🗑 丢弃最低价值</button>
              <button className="btn btn-ghost btn-sm" disabled={snap.backpack.length === 0} onClick={() => { if (window.confirm("确定清空背包吗？丢弃的矿石无法找回。")) act((g) => g.clearBackpack()); }}>清空背包</button>
            </div>
            <div className="modal-actions">
              {snap.result.canMilk && snap.result.milkRewardMult != null && (
                <button className="btn btn-milk" onClick={() => act((g) => g.milkVein())}>
                  💎 榨取矿脉 ×{snap.result.milkRewardMult}
                </button>
              )}
              <button className="btn btn-primary" onClick={() => act((g) => g.continueDescend())}>
                ⬇ 继续深入
              </button>
              <button className="btn btn-danger" disabled={snap.retreatBlocked} onClick={() => act((g) => g.retreat())}>
                🏠 返回地面
              </button>
            </div>
          </div>
        </div>
      )}

      {snap && snap.phase === "hazard" && snap.hazard && (
        <div className="run-overlay">
          <div className="panel hazard-panel">
            <div className="panel-title danger-text">👾 地底生物挡住了去路！</div>
            <p className="modal-hint">危险等级：{"◆".repeat(snap.hazard.severity)}</p>
            <div className="hazard-actions">
              <button className="btn btn-secondary" onClick={() => act((g) => g.creatureChoice("scare"))}>
                ⚡ 驱赶（耗电耗耐久）
              </button>
              <button className="btn btn-secondary" onClick={() => act((g) => g.creatureChoice("bait"))}>
                🥩 丢矿石诱饵（损失 8% 背包）
              </button>
              <button className="btn btn-overload" onClick={() => act((g) => g.creatureChoice("force"))}>
                💪 强行突破（高风险）
              </button>
              <button className="btn btn-danger" onClick={() => act((g) => g.creatureChoice("retreat"))}>
                🏠 立即撤退
              </button>
            </div>
          </div>
        </div>
      )}

      {snap && snap.phase === "anomaly" && snap.anomaly && (
        <div className="run-overlay">
          <div className="panel anomaly-panel">
            <div className="panel-title abyss-text">🌀 深渊异常</div>
            <p className="anomaly-text">{snap.anomaly.text}</p>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => act((g) => g.anomalyContinue())}>
                踏入这一层
              </button>
            </div>
          </div>
        </div>
      )}

      {snap && snap.phase === "gameover" && (
        <div className="run-overlay end-overlay">
          <div className="panel end-panel disaster">
            <h2 className="end-title">💥 灾难事故！</h2>
            <p className="modal-hint">钻机损毁，本次下矿被迫终止。救援队帮你带回了部分矿石。</p>
            <div className="end-stats">
              <div className="stat-card">
                <span className="stat-label">抵达深度</span>
                <span className="stat-value">{snap.depth}m</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">救援带回</span>
                <span className="stat-value gold">{fmt(snap.load)}</span>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={props.onExit}>
                返回主菜单
              </button>
            </div>
          </div>
        </div>
      )}

      {snap && snap.phase === "surfaced" && (
        <div className="run-overlay end-overlay">
          <div className="panel end-panel success">
            <h2 className="end-title success-title">🏠 安全返回地面！</h2>
            <p className="modal-hint">矿石已全部入库。</p>
            <div className="end-stats">
              <div className="stat-card">
                <span className="stat-label">本次入库</span>
                <span className="stat-value gold">+{fmt(snap.load)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">最深深度</span>
                <span className="stat-value cyan">{snap.depth}m</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">累计现金</span>
                <span className="stat-value purple">{fmt(props.save.stats.totalBanked)}</span>
              </div>
            </div>
            <div className="submit-area">
              {props.submitState === "submitting" && <span className="submit-note">成绩提交中…</span>}
              {props.submitState === "done" && <span className="submit-note ok">🏆 成绩已上榜！</span>}
              {props.submitState === "error" && <span className="submit-note bad">成绩提交失败</span>}
              {props.submitState === "needLogin" && (
                <button className="btn btn-primary" onClick={() => props.onOpenAuth("login")}>
                  🔑 登录后上榜
                </button>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={props.onExit}>
                返回主菜单
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
