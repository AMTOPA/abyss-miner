"use client";

import { useEffect, useRef, useState } from "react";
import { fmt, fmtCombo, type SaveData } from "@/game/config";
import { MinerGame } from "@/game/engine";
import { AudioEngine } from "@/game/audio";
import type { AuthUser } from "@/lib/api";
import { DIFFICULTY_DEFS, ORE_QUALITIES, RATING_INFO } from "@/game/items";
import type { BagSlot, RunConfig, RunResult, UiSnapshot } from "@/game/types";
import BanditPanel from "./BanditPanel";
import BlackMarketPanel from "./BlackMarketPanel";

type Props = {
  save: SaveData;
  startDepth: number;
  runConfig: RunConfig; // 大厅选择的配置（难度 / 随身现金 / 增益 / 装备 / 道具）
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

const MODE_INFO: Record<DrillMode, { name: string; desc: string; cls: string; icon: string }> = {
  cautious: { name: "稳妥钻进", desc: "收益 ×0.75 · 风险 ×0.55 · 低概率穿透", cls: "btn-cautious", icon: "🛡️" },
  standard: { name: "标准钻进", desc: "收益 ×1.00 · 风险 ×1.00 · 有概率穿透", cls: "btn-standard", icon: "⚙️" },
  overload: { name: "超载钻进", desc: "收益 ×1.70+ · 风险 ×1.65 · 高概率穿透多层", cls: "btn-overload", icon: "🔥" },
};

// 引擎公开 API（由 engine 代理实现）。
// 这里用结构类型声明我们实际用到的子集，避免与并行开发中的 engine.ts 强绑定。
type EngineHandle = {
  startRun(startDepth: number, save: SaveData, config: RunConfig): void;
  chooseMode(mode: DrillMode): void;
  useDetector(): void;
  useSupport(): void;
  useItem(slotKey: string): void;
  discardSlot(slotKey: string): void;
  retreat(): void;
  creatureChoice(action: "scare" | "bait" | "force" | "retreat"): void;
  anomalyContinue(): void;
  continueDescend(): void;
  milkVein(): void;
  skipDrill(): void;
  openBlackMarket(): void;
  bmSell(slotKey: string, count: number): void;
  bmBuy(index: number, pay: "cash" | "ore"): void;
  bmRepair(): void;
  bmClaimTask(taskId: string): void;
  bmLeave(): void;
  banditChoice(action: "pay" | "give" | "fight"): void;
  destroy(): void;
};

type EngineCtor = new (
  canvas: HTMLCanvasElement,
  save: SaveData,
  audio: AudioEngine,
  cb: { onUi: (snap: UiSnapshot) => void; onRunEnd: (result: RunResult) => void }
) => EngineHandle;

// 百分比辅助：把 0..1 转成 0%..100% 字符串（用于内联进度条）
function pct(ratio: number): string {
  return Math.max(0, Math.min(1, ratio)) * 100 + "%";
}

// 背包格子视图：矿石格（显示品质 / 数量 / 价值，可丢弃），道具格（可 使用 / 丢弃）
function BagGrid(props: {
  slots: BagSlot[];
  used: number;
  total: number;
  onUse?: (key: string) => void;
  onDiscard?: (key: string) => void;
}) {
  const emptyCount = Math.max(0, props.total - props.used);
  return (
    <div className="bag-grid">
      {props.slots.map((slot) => {
        if (slot.kind === "ore" && slot.quality) {
          const q = ORE_QUALITIES[slot.quality];
          return (
            <div key={slot.key} className="bag-cell bag-cell-ore" style={{ borderColor: slot.color }}>
              <span className="bag-icon">{q.icon}</span>
              <span className="bag-name">{slot.name}</span>
              <span className="bag-quality" style={{ color: q.color }}>{q.name}</span>
              <span className="bag-qty">×{slot.count}</span>
              <span className="bag-value">{fmt(slot.value)}</span>
              {props.onDiscard && (
                <button className="bag-discard" onClick={() => props.onDiscard!(slot.key)}>
                  丢弃
                </button>
              )}
            </div>
          );
        }
        return (
          <div key={slot.key} className="bag-cell bag-cell-item" style={{ borderColor: slot.color }}>
            <span className="bag-icon">{slot.icon ?? "📦"}</span>
            <span className="bag-name">{slot.name}</span>
            <span className="bag-qty">×{slot.count}</span>
            {props.onUse && (
              <button className="bag-use" onClick={() => props.onUse!(slot.key)}>
                使用
              </button>
            )}
            {props.onDiscard && (
              <button className="bag-discard" onClick={() => props.onDiscard!(slot.key)}>
                丢弃
              </button>
            )}
          </div>
        );
      })}
      {Array.from({ length: emptyCount }).map((_, i) => (
        <div key={"empty-" + i} className="bag-cell bag-cell-empty" />
      ))}
    </div>
  );
}

export default function RunScreen(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<EngineHandle | null>(null);
  const [snap, setSnap] = useState<UiSnapshot | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // 初始化引擎并开始一局
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const save = propsRef.current.save;
    const audio = propsRef.current.audio;
    audio.init();
    audio.play("ambient");
    // 引擎由 engine 代理实现，此处用结构类型构造，规避并行开发期的类型漂移
    const Ctor = MinerGame as unknown as EngineCtor;
    const engine = new Ctor(canvas, save, audio, {
      onUi: (s) => setSnap(s),
      onRunEnd: (r) => propsRef.current.onRunEnd(r),
    });
    engineRef.current = engine;
    engine.startRun(propsRef.current.startDepth, save, propsRef.current.runConfig);
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 统一操作入口：先播点击音效，再调用引擎方法
  const act = (fn: (g: EngineHandle) => void) => {
    const g = engineRef.current;
    if (!g) return;
    props.audio.play("click");
    fn(g);
  };

  // 返回主菜单（带确认）
  const exit = () => {
    if (window.confirm("放弃本次下矿？未入库的矿石将丢失。")) {
      engineRef.current?.destroy();
      props.onExit();
    }
  };

  return (
    <div className="run-screen">
      <canvas ref={canvasRef} className="run-canvas" />

      {/* 顶部状态栏：返回 / 静音 / 深度 / 难度 / 随身现金 / 耐久电量 / 损耗警告 */}
      <div className="run-topbar">
        <button className="btn btn-ghost btn-sm" onClick={exit}>
          ✕ 返回
        </button>
        <button className="btn btn-ghost btn-sm" onClick={props.onToggleMute}>
          {props.muted ? "🔇" : "🔊"}
        </button>
        {snap && (
          <>
            <span className="topbar-depth">{snap.depth}m</span>
            <span
              className="diff-badge"
              style={{
                color: DIFFICULTY_DEFS[snap.difficulty].color,
                borderColor: DIFFICULTY_DEFS[snap.difficulty].color,
              }}
            >
              {DIFFICULTY_DEFS[snap.difficulty].icon} {DIFFICULTY_DEFS[snap.difficulty].name}
            </span>
            <span className="pocket-chip">🪙 {fmt(snap.pocket)}</span>
            <span className="topbar-bars">
              <span className="mini-bar" title={`耐久 ${Math.round(snap.durability)}/${Math.round(snap.maxDurability)}`}>
                <span className="mini-bar-label">耐久</span>
                <span
                  className="mini-bar-track"
                  style={{ display: "inline-block", width: 64, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.16)", overflow: "hidden", verticalAlign: "middle" }}
                >
                  <span
                    className="mini-bar-fill"
                    style={{ display: "block", height: "100%", width: pct(snap.durability / Math.max(1, snap.maxDurability)), background: "#e08a45" }}
                  />
                </span>
              </span>
              <span className="mini-bar" title={`电量 ${Math.round(snap.power)}/${Math.round(snap.maxPower)}`}>
                <span className="mini-bar-label">电量</span>
                <span
                  className="mini-bar-track"
                  style={{ display: "inline-block", width: 64, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.16)", overflow: "hidden", verticalAlign: "middle" }}
                >
                  <span
                    className="mini-bar-fill"
                    style={{ display: "block", height: "100%", width: pct(snap.power / Math.max(1, snap.maxPower)), background: "#ffd166" }}
                  />
                </span>
              </span>
            </span>
            {snap.wearPenalty > 0 && (
              <span className="wear-warning">⚠️ 损耗 -{Math.round(snap.wearPenalty * 100)}%</span>
            )}
          </>
        )}
      </div>

      {/* 下潜过场 */}
      {snap && (snap.phase === "descending" || snap.phase === "idle") && (
        <div className="run-overlay center-tip">
          <div className="drilling-tip">
            <span className="drilling-spin">⬇</span>
            <span>下潜中…</span>
          </div>
        </div>
      )}

      {/* 观察层：信息面板 + 操作台 + 背包格子 */}
      {snap && snap.phase === "observe" && snap.layer && (
        <div className="run-overlay">
          <div className="observe-layout">
            <div className="panel info-panel">
              <div className="panel-title">
                <span className="layer-depth">第 {Math.floor(snap.depth / 10) + 1} 层</span> · {snap.depth}m · {snap.stageName}
              </div>
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
                <button className="btn btn-ghost" disabled={snap.supports <= 0} onClick={() => act((g) => g.useSupport())}>
                  🪨 支撑架 ×{snap.supports}
                </button>
                <button className="btn btn-danger" disabled={snap.retreatBlocked} onClick={() => act((g) => g.retreat())}>
                  🏠 返回地面
                </button>
              </div>
            </div>

            <div className="panel bag-panel">
              <div className="panel-title">
                🎒 背包 {snap.usedSlots}/{snap.slots} 格 · 总价值 {fmt(snap.load)}
              </div>
              <BagGrid
                slots={snap.bag}
                used={snap.usedSlots}
                total={snap.slots}
                onUse={(key) => act((g) => g.useItem(key))}
                onDiscard={(key) => act((g) => g.discardSlot(key))}
              />
            </div>
          </div>
        </div>
      )}

      {/* 钻进中：进度 + 跳过 */}
      {snap && snap.phase === "drilling" && snap.drilling && (
        <div className="run-overlay center-tip">
          <div className="drilling-tip">
            <span className="drilling-spin">⛏️</span>
            <span>{MODE_INFO[snap.drilling.mode].name}中…</span>
            <span className="drill-progress">
              <span className="drill-progress-fill" style={{ width: `${Math.round((snap.drilling.progress ?? 0) * 100)}%` }} />
            </span>
            <button className="btn btn-ghost btn-sm skip-btn" onClick={() => act((g) => g.skipDrill())}>
              跳过 ⏭
            </button>
          </div>
        </div>
      )}

      {/* 结算：收益 + 事件 + 背包操作 + 继续/黑市/返回地面 */}
      {snap && snap.phase === "result" && snap.result && (
        <div className="run-overlay">
          <div className="panel result-panel">
            <div className="result-value">
              <span className="result-label">本次收益</span>
              <span className="result-amount gold">+{fmt(snap.result.value)}</span>
              <span className="result-combo">
                Combo {snap.result.comboDelta > 0 ? `+${snap.result.comboDelta.toFixed(2)}` : ""} → {fmtCombo(snap.combo)}
              </span>
            </div>
            {snap.result.layers > 1 && (
              <div className="penetrate-badge" data-testid="penetrate-badge">
                ⚡ 穿透 ×{snap.result.layers} 层！一次钻进 {snap.result.layers * 10}m
              </div>
            )}
            {snap.result.droppedItem && (
              <div className="dropped-item">
                💥 拾取道具：{snap.result.droppedItem.icon} {snap.result.droppedItem.name}
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
            <div className="bag-total">
              背包 {snap.usedSlots}/{snap.slots} 格 · 总价值 {fmt(snap.load)}
            </div>
            <BagGrid
              slots={snap.bag}
              used={snap.usedSlots}
              total={snap.slots}
              onUse={(key) => act((g) => g.useItem(key))}
              onDiscard={(key) => act((g) => g.discardSlot(key))}
            />
            <div className="bag-tools">
              <button
                className="btn btn-ghost btn-sm"
                disabled={!snap.bag.some((b) => b.kind === "ore")}
                onClick={() => {
                  // 找到总价值最低的矿石格并丢弃（快速腾格）
                  const ores = snap.bag.filter((b) => b.kind === "ore").sort((a, b) => a.value - b.value);
                  if (ores[0]) act((g) => g.discardSlot(ores[0].key));
                }}
              >
                🗑 丢弃最低价值
              </button>
            </div>
            <div className="modal-actions">
              {snap.result.canMilk && snap.result.milkRewardMult != null && (
                <button className="btn btn-milk" onClick={() => act((g) => g.milkVein())}>
                  💎 榨取矿脉 ×{snap.result.milkRewardMult}
                </button>
              )}
              {snap.result.canBlackMarket && (
                <button className="btn btn-secondary" onClick={() => act((g) => g.openBlackMarket())}>
                  🚪 前往黑市
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

      {/* 遭遇地底生物：四种应对 */}
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
                🥩 丢矿石诱饵（损失部分矿石）
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

      {/* 深渊异常：继续 */}
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

      {/* 强盗（硬核难度）：给现金 / 交矿石 / 反抗 */}
      {snap && snap.phase === "bandit" && snap.bandit && (
        <BanditPanel
          severity={snap.bandit.severity}
          pocket={snap.bandit.pocket}
          onChoice={(action) => act((g) => g.banditChoice(action))}
        />
      )}

      {/* 黑市：出售 / 货架 / 维修 / 任务板 */}
      {snap && snap.phase === "blackmarket" && snap.blackmarket && (
        <BlackMarketPanel
          view={snap.blackmarket}
          onSell={(key, count) => act((g) => g.bmSell(key, count))}
          onBuy={(index, pay) => act((g) => g.bmBuy(index, pay))}
          onRepair={() => act((g) => g.bmRepair())}
          onClaim={(taskId) => act((g) => g.bmClaimTask(taskId))}
          onLeave={() => act((g) => g.bmLeave())}
        />
      )}

      {/* 灾难结束 */}
      {snap && snap.phase === "gameover" && snap.gameover && (
        <div className="run-overlay end-overlay">
          <div className="panel end-panel disaster">
            <h2 className="end-title">💥 灾难事故！</h2>
            <p className="modal-hint">{snap.gameover.reason || "钻机损毁，本次下矿被迫终止。救援队帮你带回了部分矿石。"}</p>
            <div className="end-stats">
              <div className="stat-card">
                <span className="stat-label">抵达深度</span>
                <span className="stat-value">{snap.gameover.depth}m</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">救援带回</span>
                <span className="stat-value gold">+{fmt(snap.gameover.saved)}</span>
              </div>
              {snap.gameover.pocketLost > 0 && (
                <div className="stat-card">
                  <span className="stat-label">随身现金损失</span>
                  <span className="stat-value" style={{ color: "#ff8a80" }}>-{fmt(snap.gameover.pocketLost)}</span>
                </div>
              )}
              {snap.gameover.best && (
                <div className="stat-card">
                  <span className="stat-label">抵达最深</span>
                  <span className="stat-value cyan">新纪录！</span>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={props.onExit}>
                返回主菜单
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 安全返回地面：评级 + 结算 + 上榜 */}
      {snap && snap.phase === "surfaced" && snap.surfaced && (
        <div className="run-overlay end-overlay">
          <div className="panel end-panel success">
            <h2 className="end-title success-title">🏠 安全返回地面！</h2>
            <p className="modal-hint">矿石与随身现金已全部入库。</p>
            {snap.surfaced.rating && (
              <div
                className={`rating-badge rating-${snap.surfaced.rating}`}
                style={{ color: RATING_INFO[snap.surfaced.rating].color, borderColor: RATING_INFO[snap.surfaced.rating].color }}
              >
                {snap.surfaced.rating} · {RATING_INFO[snap.surfaced.rating].name}
              </div>
            )}
            <div className="end-stats">
              <div className="stat-card">
                <span className="stat-label">本次入库</span>
                <span className="stat-value gold">+{fmt(snap.surfaced.banked)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">最深深度</span>
                <span className="stat-value cyan">{snap.surfaced.depth}m</span>
              </div>
              {snap.surfaced.bonusCash > 0 && (
                <div className="stat-card">
                  <span className="stat-label">评级奖励</span>
                  <span className="stat-value gold">+{fmt(snap.surfaced.bonusCash)}</span>
                </div>
              )}
              {snap.surfaced.pocketReturn > 0 && (
                <div className="stat-card">
                  <span className="stat-label">随身现金归还</span>
                  <span className="stat-value">+{fmt(snap.surfaced.pocketReturn)}</span>
                </div>
              )}
              <div className="stat-card">
                <span className="stat-label">累计现金</span>
                <span className="stat-value purple">{fmt(snap.surfaced.totalBanked)}</span>
              </div>
            </div>
            {snap.surfaced.best && <p className="modal-hint new-best">🏅 新纪录！</p>}
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
