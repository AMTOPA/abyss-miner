import {
  ORES, OreId, SaveData, StageId,
  backpackStats, detectionStats, drillStats,
  fmt, fmtCombo, persistSave, safetyStats, stageForDepth, supportStats,
} from "./config";
import {
  HazardId, Layer, VEIN_NAME, generateLayer, hazardName, layerBaseValue, rollOreYield,
} from "./world";
import { AudioEngine } from "./audio";

export type DrillMode = "cautious" | "standard" | "overload";
export type Phase = "idle" | "descending" | "observe" | "drilling" | "result" | "hazard" | "anomaly" | "gameover" | "surfaced";
export type RunEndKind = "surfaced" | "disaster";

export type LogEntry = { text: string; kind: "info" | "good" | "bad" | "warn" };
export type BackpackItem = { id: OreId; name: string; count: number; color: string; value: number };

export type UiSnapshot = {
  phase: Phase;
  depth: number;
  stageName: string;
  power: number; maxPower: number;
  durability: number; maxDurability: number;
  overheat: number;
  combo: number;
  supports: number;
  detectors: number;
  capacity: number;
  load: number;
  loadRatio: number;
  backpack: BackpackItem[];
  layer: {
    signals: string[];
    hardnessText: string;
    qualityText: string;
    hazardText: string | null;
    collapseRiskLabel: string;
    revealed: boolean;
    anomalyEffect: string | null;
    milkingAvailable: boolean;
    milkCount: number;
    stage: StageId;
  } | null;
  result: {
    ores: BackpackItem[];
    value: number;
    comboDelta: number;
    events: string[];
    canMilk: boolean;
    milkRewardMult: number | null;
    layers: number;
  } | null;
  hazard: { type: "creature"; severity: number } | null;
  anomaly: { text: string } | null;
  gameover: { reason: string; lost: number; saved: number; depth: number; best: boolean } | null;
  surfaced: { banked: number; depth: number; totalBanked: number; best: boolean } | null;
  retreatBlocked: boolean;
  log: LogEntry[];
  drilling: { progress: number; mode: DrillMode; hardness: number } | null;
  canDrill: boolean;
};

export type RunResult = { kind: RunEndKind; banked: number; depth: number; best: boolean; save: SaveData };

export type EngineCallbacks = { onUi: (snap: UiSnapshot) => void; onRunEnd: (result: RunResult) => void };

const MILK_MULT = [1, 1.5, 2.2, 3.5];
const MILK_RISK = [0.1, 0.2, 0.35, 0.55];

// 穿透：一次钻进有一定概率一次钻穿多层，上限 10 层，概率逐层递减
const PENETRATE_BASE: Record<DrillMode, number> = { cautious: 0.04, standard: 0.1, overload: 0.2 };
const PENETRATE_DECAY = 0.55;
const PENETRATE_CAP = 10;


// 可复现随机（用于画面装饰，保证同一层不闪烁）
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Particle = {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; color: string;
  type: "dust" | "spark" | "debris" | "ore" | "fog" | "ember" | "glow";
  grav?: number;
};

type FloatText = { x: number; y: number; text: string; color: string; life: number; maxLife: number; size: number };

export class MinerGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private audio: AudioEngine;
  private cb: EngineCallbacks;
  private save: SaveData;
  private raf = 0;
  private lastTime = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;

  phase: Phase = "idle";
  private depth = 0;
  private layer: Layer | null = null;
  private power = 100;
  private durability = 100;
  private maxDurability = 100;
  private overheat = 0;
  private combo = 1;
  private supports = 0;
  private detectors = 0;
  private capacity = 100;
  private backpackCount: Record<OreId, number> = { stone: 0, copper: 0, iron: 0, silver: 0, gold: 0, diamond: 0, crystal: 0, unknown: 0 };
  private loadValue = 0;
  private milkCount = 0;
  private supportsUsedThisLayer = false;
  private retreatBlocked = 0;
  private anomalyDouble = false;
  private anomalyDoubleLoss = false;
  private detectorDisabled = false;
  private megaShieldUsed = false;
  private runEnded = false;

  private particles: Particle[] = [];
  private floatTexts: FloatText[] = [];
  private shake = 0;
  private flash = 0;
  private flashColor = "#ffffff";
  private time = 0;
  private phaseTimer = 0;
  private drillProgress = 0;
  private drillMode: DrillMode = "standard";
  private drillDuration = 1;
  private log: LogEntry[] = [];
  private oreGlints: Array<{ x: number; y: number; color: string; r: number }> = [];
  private eyes: Array<{ x: number; y: number; phase: number }> = [];
  private wallHole = 0;
  private hazardSeverity = 1;
  private rockScroll = 0;
  private rockSwoosh = 0;
  private depthDisplay = 0;

  constructor(canvas: HTMLCanvasElement, save: SaveData, audio: AudioEngine, cb: EngineCallbacks) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
    this.audio = audio;
    this.cb = cb;
    this.save = save;
    this.resize();
    window.addEventListener("resize", this.resize);
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.audio.stopDrill();
  }

  private resize = (): void => {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = this.w + "px";
    this.canvas.style.height = this.h + "px";
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  // ---------------- 公共操作 ----------------

  startRun(startDepth: number, save: SaveData): void {
    this.save = save;
    this.depth = startDepth;
    this.depthDisplay = startDepth;
    this.power = 100;
    this.overheat = 0;
    this.combo = 1;
    this.milkCount = 0;
    this.retreatBlocked = 0;
    this.anomalyDouble = false;
    this.anomalyDoubleLoss = false;
    this.detectorDisabled = false;
    this.megaShieldUsed = false;
    this.runEnded = false;
    const ds = drillStats(save.upgrades.drill);
    this.maxDurability = ds.maxDurability;
    this.durability = ds.maxDurability;
    const bs = backpackStats(save.upgrades.backpack);
    this.capacity = bs.capacity;
    const ss = supportStats(save.upgrades.support);
    this.supports = ss.supports;
    const det = detectionStats(save.upgrades.detection);
    this.detectors = det.detectors;
    this.resetBackpack();
    this.particles = [];
    this.floatTexts = [];
    this.log = [];
    this.layer = generateLayer(startDepth, { accuracy: det.accuracy });
    this.applyPreview(det.previewChance);
    this.applyAnomalyOnEntry();
    this.phase = "descending";
    this.phaseTimer = 1.4;
    this.wallHole = 0;
    this.rockScroll = 0;
    this.rockSwoosh = 1;
    this.pushUi();
    this.audio.play("ambient");
    this.logAdd(`升降机抵达 ${startDepth}m，准备下矿`, "info");
  }

  chooseMode(mode: DrillMode): void {
    if (this.phase !== "observe") return;
    if (this.power <= 0) { this.logAdd("电量不足，无法钻进", "bad"); return; }
    this.drillMode = mode;
    const hardness = this.layer?.hardness ?? 1;
    const base = mode === "cautious" ? 2.4 : mode === "standard" ? 1.7 : 1.15;
    this.drillDuration = base * (1 + (hardness - 1) * 0.14);
    this.drillProgress = 0;
    this.wallHole = 0;
    this.phase = "drilling";
    this.audio.play("drill", mode === "overload" ? 0.9 : mode === "standard" ? 0.55 : 0.3);
    this.logAdd(mode === "cautious" ? "开始稳妥钻进…" : mode === "standard" ? "开始标准钻进…" : "钻机超载运转！", "info");
    this.pushUi();
  }

  useDetector(): void {
    if (this.phase !== "observe" || !this.layer || this.detectors <= 0) return;
    if (this.detectorDisabled) { this.logAdd("探测器受到干扰，无法使用", "bad"); return; }
    this.detectors--;
    this.layer.revealed = {
      collapseRisk: this.layer.collapseRisk,
      quality: this.layer.quality,
      hazard: this.layer.hazard,
    };
    this.audio.play("detector");
    this.logAdd("探测器扫描完成：获取了精确信息", "good");
    this.pushUi();
  }

  useSupport(): void {
    if (this.phase !== "observe" || this.supports <= 0 || this.supportsUsedThisLayer) return;
    this.supports--;
    this.supportsUsedThisLayer = true;
    this.audio.play("support");
    this.logAdd("已放置支撑架，本层塌方风险大幅降低", "good");
    this.pushUi();
  }

  retreat(): void {
    if (this.phase !== "observe" && this.phase !== "result") return;
    if (this.retreatBlocked > 0) {
      this.logAdd(`撤退通道被封锁，还需继续 ${this.retreatBlocked} 层`, "bad");
      return;
    }
    this.finishRun("surfaced");
  }

  emergencyRetreat(): void {
    if (this.phase !== "hazard") return;
    const ss = safetyStats(this.save.upgrades.safety);
    const overload = this.loadRatio() > 1.15 ? 0.12 : 0;
    if (Math.random() < ss.retreatSuccess - overload) {
      this.logAdd("紧急撤退成功！", "good");
      this.finishRun("surfaced");
    } else {
      const lost = this.removeOreValue(0.15);
      this.durability = Math.max(0, this.durability - 15);
      this.audio.play("accident");
      this.logAdd(`紧急撤退受挫，损失了 ${fmt(lost)} 矿石`, "bad");
      this.finishRun("surfaced");
    }
  }

  creatureChoice(action: "scare" | "bait" | "force" | "retreat"): void {
    if (this.phase !== "hazard") return;
    const severity = this.hazardSeverity;
    this.hazardSeverity = 1;
    switch (action) {
      case "scare": {
        this.power = Math.max(0, this.power - (20 + 8 * severity));
        this.durability = Math.max(0, this.durability - (10 + 4 * severity));
        const risk = 0.2 + 0.1 * severity;
        if (Math.random() < risk) {
          this.audio.play("accident");
          this.logAdd("驱赶失败！怪物反击造成事故", "bad");
          this.applyAccident("minor");
        } else {
          this.logAdd("驱赶成功，怪物退入黑暗", "good");
        }
        break;
      }
      case "bait": {
        const lost = this.removeOreValue(0.08);
        this.logAdd(`丢出矿石诱饵，损失 ${fmt(lost)}`, "warn");
        break;
      }
      case "force": {
        const risk = 0.38 + 0.12 * severity;
        if (Math.random() < risk) {
          this.audio.play("accident");
          this.logAdd("强行突破失败！", "bad");
          this.applyAccident("severe");
        } else {
          this.logAdd("你贴着岩壁强行突破，怪物没有追上", "good");
        }
        break;
      }
      case "retreat":
        this.emergencyRetreat();
        return;
    }
    this.phase = "result";
    this.pushUi();
  }

  milkVein(): void {
    if (this.phase !== "result" || !this.layer) return;
    if (!this.canMilk()) return;
    if (this.power < 12) { this.logAdd("电量不足，无法继续榨取", "bad"); return; }
    const idx = this.milkCount;
    const mult = MILK_MULT[Math.min(idx, MILK_MULT.length - 1)];
    const extraRisk = MILK_RISK[Math.min(idx, MILK_RISK.length - 1)];
    this.power = Math.max(0, this.power - 12);
    this.durability = Math.max(0, this.durability - (6 + 2 * idx));
    const yields = rollOreYield(this.depth, this.layer.ores, this.layer.quality, mult, this.combo, 2 + Math.floor(Math.random() * 2));
    const value = layerBaseValue(yields);
    this.addOres(yields);
    this.milkCount++;
    this.audio.play("milking");
    this.logAdd(`榨取矿脉 +${fmt(value)}（第 ${this.milkCount} 次）`, "good");
    const risk = Math.min(0.85, this.baseRisk() + extraRisk + (this.loadRatio() > 1 ? 0.08 : 0));
    if (Math.random() < risk) {
      this.audio.play("warning");
      this.logAdd("榨取时岩层剧烈震动……", "warn");
      this.applyAccident(this.rollSeverity(risk));
    }
    if (this.runEnded) return;
    this.pushUi();
  }

  leaveVein(): void { if (this.phase === "result") this.advanceLayer(); }
  continueDescend(): void { if (this.phase === "result") this.advanceLayer(); }
  anomalyContinue(): void {
    if (this.phase !== "anomaly") return;
    this.phase = "observe";
    this.pushUi();
  }

  // ---------------- 内部逻辑 ----------------

  private resetBackpack(): void {
    this.backpackCount = { stone: 0, copper: 0, iron: 0, silver: 0, gold: 0, diamond: 0, crystal: 0, unknown: 0 };
    this.loadValue = 0;
  }

  private logAdd(text: string, kind: LogEntry["kind"] = "info"): void {
    this.log.push({ text, kind });
    if (this.log.length > 6) this.log.shift();
  }

  private loadRatio(): number {
    return this.capacity > 0 ? this.loadValue / this.capacity : 0;
  }

  private canMilk(): boolean {
    return !!this.layer && (this.layer.quality === "rich" || this.layer.quality === "legendary") && this.milkCount < 4;
  }

  private advanceLayer(): void {
    this.depth += 10;
    this.milkCount = 0;
    this.supportsUsedThisLayer = false;
    this.detectorDisabled = false;
    this.anomalyDouble = false;
    this.unlockCheckpoints();
    const det = detectionStats(this.save.upgrades.detection);
    this.layer = generateLayer(this.depth, { accuracy: det.accuracy });
    this.applyPreview(det.previewChance);
    this.applyAnomalyOnEntry();
    this.phase = "descending";
    this.phaseTimer = 1.15;
    this.wallHole = 0;
    this.rockSwoosh = 1;
    this.oreGlints = [];
    this.eyes = [];
    this.audio.play("drillStop");
    this.audio.play("retreat");
    this.pushUi();
  }

  private applyPreview(chance: number): void {
    if (!this.layer || chance <= 0 || Math.random() >= chance) return;
    const next = generateLayer(this.depth + 10, {});
    this.layer.signals.push(`[预知] 下一层塌方风险：${riskLabel(next.collapseRisk)}`);
  }

  private applyAnomalyOnEntry(): void {
    const l = this.layer;
    if (!l) return;
    if (l.hazard === "anomaly" && l.anomalyEffect) {
      const e = l.anomalyEffect;
      if (e.includes("双倍法则")) { this.anomalyDouble = true; this.anomalyDoubleLoss = true; }
      else if (e.includes("单行道")) this.retreatBlocked += 2;
      else if (e.includes("探测干扰")) this.detectorDisabled = true;
      this.audio.play("anomaly");
      this.logAdd("深渊异常正在生效……", "warn");
    }
  }

  private baseRisk(useSupport: boolean = this.supportsUsedThisLayer): number {
    const l = this.layer;
    if (!l) return 0.05;
    const ss = supportStats(this.save.upgrades.support);
    let risk = l.collapseRisk * (1 - 0.03 * this.save.upgrades.safety);
    risk *= useSupport ? ss.effect : 1;
    risk *= 1 + this.overheat * 0.004;
    const r = this.loadRatio();
    if (r > 1) risk += 0.12 + 0.06 * Math.floor((r - 1) * 10);
    else if (r > 0.8) risk += 0.12;
    else if (r > 0.6) risk += 0.06;
    if (this.anomalyDouble) risk *= 1.2;
    return Math.max(0.03, Math.min(0.9, risk));
  }

  private rollSeverity(risk: number): "minor" | "severe" | "disaster" {
    const r = Math.random();
    const severeThresh = 0.62 - risk * 0.25;
    const disasterThresh = 0.9 - risk * 0.25;
    if (r > disasterThresh) return "disaster";
    if (r > severeThresh) return "severe";
    return "minor";
  }

  private applyAccident(severity: "minor" | "severe" | "disaster"): void {
    if (severity === "minor") {
      this.durability = Math.max(0, this.durability - 10);
      this.power = Math.max(0, this.power - 10);
      this.combo = Math.max(1, this.combo - 0.3);
      this.shake = Math.max(this.shake, 6);
      this.audio.play("accident");
      this.logAdd("小事故：设备受损，Combo 降低", "bad");
      return;
    }
    if (severity === "severe") {
      const lost = this.removeOreValue(0.3);
      this.combo = 1;
      this.durability = Math.max(0, this.durability - 20);
      this.depth = Math.max(0, this.depth - 10);
      this.shake = Math.max(this.shake, 12);
      this.flash = 0.5;
      this.flashColor = "#ff5522";
      this.audio.play("accident");
      this.logAdd(`严重事故！损失 ${fmt(lost)} 矿石，退回上一层`, "bad");
      return;
    }
    const ss = supportStats(this.save.upgrades.support);
    if (!this.megaShieldUsed && ss.megaShield) {
      this.megaShieldUsed = true;
      this.audio.play("megaShield");
      this.logAdd("高级支撑架替你抵挡了灾难！", "good");
      this.applyAccident("severe");
      return;
    }
    this.endByDisaster();
  }

  private endByDisaster(): void {
    const lossMult = this.anomalyDoubleLoss
      ? Math.min(0.95, safetyStats(this.save.upgrades.safety).disasterLoss * 2)
      : safetyStats(this.save.upgrades.safety).disasterLoss;
    const lost = this.removeOreValue(lossMult);
    const saved = this.loadValue;
    const depthAt = this.depth;
    this.save.stats.disasters++;
    this.save.stats.runs++;
    this.save.stats.totalBanked += saved;
    this.save.stats.bestRunValue = Math.max(this.save.stats.bestRunValue, saved);
    this.save.stats.bestDepth = Math.max(this.save.stats.bestDepth, depthAt);
    this.save.cash += saved;
    persistSave(this.save);
    this.phase = "gameover";
    this.runEnded = true;
    this.audio.stopDrill();
    this.audio.play("disaster");
    this.shake = Math.max(this.shake, 22);
    this.flash = 0.9;
    this.flashColor = "#ff2200";
    this.logAdd(`灾难事故！损失 ${fmt(lost)}，救援队带回 ${fmt(saved)}`, "bad");
    const snap = this.buildSnapshot();
    this.cb.onUi(snap);
    this.cb.onRunEnd({ kind: "disaster", banked: saved, depth: depthAt, best: false, save: this.save });
  }

  private finishRun(kind: "surfaced"): void {
    if (this.runEnded) return;
    const banked = this.loadValue;
    const depthAt = this.depth;
    this.save.stats.runs++;
    this.save.stats.totalBanked += banked;
    this.save.cash += banked;
    const wasBest = banked > this.save.stats.bestRunValue;
    this.save.stats.bestRunValue = Math.max(this.save.stats.bestRunValue, banked);
    this.save.stats.bestDepth = Math.max(this.save.stats.bestDepth, depthAt);
    persistSave(this.save);
    this.runEnded = true;
    this.audio.stopDrill();
    this.audio.play("success");
    this.phase = "surfaced";
    this.logAdd(`安全返回地面，共入库 ${fmt(banked)}`, "good");
    const snap = this.buildSnapshot();
    this.cb.onUi(snap);
    this.cb.onRunEnd({ kind, banked, depth: depthAt, best: wasBest, save: this.save });
  }

  private addOres(yields: { id: OreId; value: number }[]): void {
    for (const y of yields) {
      this.backpackCount[y.id]++;
      this.loadValue += y.value;
    }
  }

  private removeOreValue(ratio: number): number {
    const target = this.loadValue * ratio;
    let removed = 0;
    const perValue = this.totalCount() > 0 ? this.loadValue / this.totalCount() : 0;
    if (perValue <= 0) return 0;
    const order = (Object.keys(this.backpackCount) as OreId[]).sort((a, b) => ORES[a].mult - ORES[b].mult);
    for (const id of order) {
      if (removed >= target || this.backpackCount[id] <= 0) continue;
      const count = Math.ceil((target - removed) / Math.max(perValue, 1));
      const drop = Math.min(this.backpackCount[id], Math.max(1, count));
      this.backpackCount[id] -= drop;
      removed += drop * perValue;
    }
    this.loadValue = Math.max(0, this.loadValue - removed);
    return Math.round(removed);
  }

  private totalCount(): number {
    return Object.values(this.backpackCount).reduce((s, v) => s + v, 0);
  }

  // ---------------- 钻进结算 ----------------

  private resolveDrill(): void {
    if (!this.layer) return;
    const events: string[] = [];
    const mode = this.drillMode;
    const ds = drillStats(this.save.upgrades.drill);
    const modeMult = mode === "cautious" ? 0.75 : mode === "standard" ? 1 : 1.7 + ds.overloadGain;
    const comboDelta = mode === "cautious" ? 0.08 : mode === "standard" ? 0.1 : 0.13;
    const layers = this.rollPenetration();
    let totalValue = 0;
    let interrupted = false;

    for (let i = 0; i < layers; i++) {
      const l = this.layer!;
      const isFirst = i === 0;
      const double = isFirst ? this.anomalyDouble : !!l.anomalyEffect?.includes("双倍法则");
      const comboBefore = this.combo;
      const yields = rollOreYield(this.depth, l.ores, l.quality, modeMult, comboBefore);
      let value = layerBaseValue(yields);
      if (double) {
        value *= 2;
        this.logAdd("深渊双倍法则：本层收益翻倍！", "good");
      }
      this.addOres(yields.map((y) => ({ id: y.id, value: y.value })));
      totalValue += value;

      this.combo = Math.min(5, this.combo + comboDelta);

      const powerBase = (7 + l.hardness * 1.6) * (mode === "cautious" ? 1.2 : mode === "standard" ? 1 : 1.5);
      const heatMult = 1 + this.overheat * 0.003;
      this.power = Math.max(0, this.power - powerBase * heatMult);
      const durLoss = (5 + l.hardness * 2) * (mode === "cautious" ? 0.7 : mode === "standard" ? 1 : 1.6)
        * ds.durabilityLossMult * (1 + this.overheat * 0.004);
      this.durability = Math.max(0, this.durability - durLoss);

      if (l.stage === "magma") {
        const heatGain = (12 + 8 * l.hazardSeverity) * (mode === "cautious" ? 0.45 : mode === "standard" ? 1 : 1.65);
        this.overheat = Math.min(100, this.overheat + heatGain);
        if (mode === "cautious") this.overheat = Math.max(0, this.overheat - 8);
        if (this.overheat >= 100) {
          this.durability = Math.max(0, this.durability - 8);
          events.push("设备过热！耐久持续下降");
        }
      }

      if (l.hazard === "gas" && Math.random() < 0.65) {
        const ss = safetyStats(this.save.upgrades.safety);
        const drain = (16 + 10 * l.hazardSeverity) * (1 - ss.gasResist);
        this.power = Math.max(0, this.power - drain);
        this.audio.play("warning");
        events.push(`毒气泄漏！电量 -${Math.round(drain)}`);
      }

      if (l.anomalyEffect?.includes("矿石异变")) {
        const bonus = Math.round(this.loadValue * 0.1);
        this.loadValue += bonus;
        events.push(`矿石异变：背包价值 +${fmt(bonus)}`);
      }
      if (!isFirst && l.anomalyEffect?.includes("单行道")) {
        this.retreatBlocked += 2;
        events.push("单行道：撤退通道被封锁");
      }

      let risk = this.baseRisk(isFirst ? this.supportsUsedThisLayer : false);
      if (l.anomalyEffect?.includes("重力紊乱")) risk = Math.min(0.9, risk * 0.55);
      risk *= mode === "cautious" ? 0.55 : mode === "standard" ? 1 : 1.65;

      this.anomalyDoubleLoss = double;
      const severity = Math.random() < risk ? this.rollSeverity(risk) : null;
      if (severity) {
        this.audio.play("warning");
        this.applyAccident(severity);
        if (this.runEnded) return;
        if (severity === "severe" && layers > 1) {
          interrupted = true;
          events.push("严重事故：穿透被打断，撤回一层");
        }
      }

      if (l.hazard === "creature" && !severity) {
        this.hazardSeverity = l.hazardSeverity;
        this.phase = "hazard";
        this.audio.play("creature");
        this.logAdd("一头地底生物挡住了去路……", "warn");
        this.pushUi();
        return;
      }

      if (this.power <= 0 || this.durability <= 0) {
        this.endByDisaster();
        return;
      }

      if (interrupted) break;

      if (i < layers - 1) {
        this.depth += 10;
        const det = detectionStats(this.save.upgrades.detection);
        this.layer = generateLayer(this.depth, { accuracy: det.accuracy });
        this.milkCount = 0;
      }
    }

    this.unlockCheckpoints();
    this.milkCount = 0;
    this.supportsUsedThisLayer = false;
    this.detectorDisabled = false;
    this.anomalyDouble = false;
    this.anomalyDoubleLoss = false;

    if (layers > 1) {
      this.floatTexts.push({
        x: this.w / 2, y: this.rockFaceY() - 60,
        text: `穿透 ×${layers}!`, color: "#ffc857", life: 1.3, maxLife: 1.3, size: 26,
      });
      this.audio.play("success");
    }

    this.phase = "result";
    const oreList = Object.entries(this.backpackCount)
      .filter(([, c]) => c > 0)
      .map(([id, count]) => ({
        id: id as OreId, name: ORES[id as OreId].name, count,
        color: ORES[id as OreId].color,
        value: Math.round(this.loadValue),
      }));
    const milkRewardMult = this.canMilk() ? MILK_MULT[Math.min(this.milkCount, MILK_MULT.length - 1)] : null;
    this.cb.onUi({
      ...this.buildSnapshot(),
      phase: "result",
      result: {
        ores: oreList,
        value: Math.round(totalValue),
        comboDelta: Math.round(comboDelta * 100) / 100,
        events,
        canMilk: this.canMilk(),
        milkRewardMult,
        layers,
      },
    });
  }

  private rollPenetration(): number {
    const bonus = Math.min(0.08, 0.006 * this.save.upgrades.drill);
    const base = PENETRATE_BASE[this.drillMode] + bonus;
    let layers = 1;
    while (layers < PENETRATE_CAP) {
      const p = base * Math.pow(PENETRATE_DECAY, layers - 1);
      if (Math.random() >= p) break;
      layers++;
    }
    return layers;
  }

  private unlockCheckpoints(): void {
    for (const cp of [100, 300, 600, 1000]) {
      if (this.depth >= cp && !this.save.unlockedCheckpoints.includes(cp)) {
        this.save.unlockedCheckpoints.push(cp);
        this.save.unlockedCheckpoints.sort((a, b) => a - b);
        persistSave(this.save);
        this.logAdd(`已解锁 ${cp}m 升降机检查点！`, "good");
      }
    }
  }

  // ---------------- 更新循环 ----------------

  private loop = (t: number): void => {
    const dt = Math.min(0.05, (t - this.lastTime) / 1000);
    this.lastTime = t;
    this.time += dt;
    this.update(dt);
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    this.phaseTimer -= dt;
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 1.6);

    this.rockScroll += dt * (10 + this.rockSwoosh * 420 + (this.phase === "drilling" ? 60 : 0));
    this.rockSwoosh = Math.max(0, this.rockSwoosh - dt * 1.5);
    this.depthDisplay += (this.depth - this.depthDisplay) * Math.min(1, dt * 5);

    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.grav) p.vy += p.grav * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floatTexts) {
      f.life -= dt;
      f.y -= 28 * dt;
    }
    this.floatTexts = this.floatTexts.filter((f) => f.life > 0);

    if (Math.random() < dt * 8) {
      this.particles.push({
        x: Math.random() * this.w, y: this.h + 10,
        vx: (Math.random() - 0.5) * 8, vy: -(10 + Math.random() * 20),
        life: 6 + Math.random() * 4, maxLife: 10, size: 1 + Math.random() * 2,
        color: "rgba(200,180,150,0.35)", type: "dust",
      });
    }
    if (this.layer?.stage === "magma" && Math.random() < dt * 6) {
      this.particles.push({
        x: Math.random() * this.w, y: this.h,
        vx: (Math.random() - 0.5) * 14, vy: -(30 + Math.random() * 40),
        life: 2 + Math.random() * 2, maxLife: 4, size: 1 + Math.random() * 2,
        color: Math.random() < 0.5 ? "rgba(255,120,40,0.8)" : "rgba(255,200,80,0.7)", type: "ember",
      });
    }

    if (this.phase !== "drilling" && Math.random() < dt * 6) {
      this.particles.push({
        x: this.w / 2 + (Math.random() - 0.5) * 90, y: this.rockFaceY() + 4,
        vx: (Math.random() - 0.5) * 24, vy: 30 + Math.random() * 50,
        life: 0.6 + Math.random() * 0.6, maxLife: 1.2, size: 1 + Math.random() * 1.6,
        color: "#9c8f7c", type: "debris", grav: 130,
      });
    }
    if (this.rockSwoosh > 0.4 && Math.random() < dt * 40) {
      this.particles.push({
        x: this.w / 2 + (Math.random() - 0.5) * 140, y: this.rockFaceY() + (Math.random() - 0.2) * 50,
        vx: (Math.random() - 0.5) * 70, vy: -20 - Math.random() * 70,
        life: 0.5 + Math.random() * 0.6, maxLife: 1.1, size: 1.5 + Math.random() * 2,
        color: "rgba(210,190,160,0.55)", type: "dust",
      });
    }
    if (this.phase === "drilling") {
      const speed = 1 / this.drillDuration;
      this.drillProgress += dt * speed;
      this.wallHole = Math.min(1, this.drillProgress);
      const cx = this.w / 2 + Math.sin(this.time * 40) * 4;
      const cy = this.rockFaceY() - 10;
      if (Math.random() < dt * 40) {
        this.particles.push({
          x: cx + (Math.random() - 0.5) * 30, y: cy + (Math.random() - 0.5) * 10,
          vx: (Math.random() - 0.5) * 160, vy: (Math.random() - 0.5) * 160,
          life: 0.3 + Math.random() * 0.4, maxLife: 0.7, size: 1 + Math.random() * 2,
          color: Math.random() < 0.6 ? "#ffd166" : "#ff9f43", type: "spark",
        });
      }
      if (Math.random() < dt * 14) {
        this.particles.push({
          x: cx + (Math.random() - 0.5) * 40, y: cy + (Math.random() - 0.5) * 20,
          vx: (Math.random() - 0.5) * 120, vy: 40 + Math.random() * 90,
          life: 0.5 + Math.random() * 0.5, maxLife: 1, size: 2 + Math.random() * 2,
          color: "#9c8f7c", type: "debris", grav: 300,
        });
      }
      this.shake = Math.max(this.shake, 1.2 + (this.drillMode === "overload" ? 2.2 : 0.6));
      if (this.drillProgress >= 1) {
        this.audio.play("drillStop");
        this.audio.play("ore", this.layer && this.layer.quality === "legendary" ? 1 : this.layer && this.layer.quality === "rich" ? 0.75 : 0.4);
        for (let i = 0; i < 18; i++) {
          const ore = this.layer ? this.layer.ores[Math.floor(Math.random() * this.layer.ores.length)] : "copper";
          this.particles.push({
            x: cx + (Math.random() - 0.5) * 60, y: cy + (Math.random() - 0.5) * 40,
            vx: (Math.random() - 0.5) * 240, vy: -80 - Math.random() * 220,
            life: 0.8 + Math.random() * 0.8, maxLife: 1.6, size: 2 + Math.random() * 3,
            color: ORES[ore].color, type: "ore", grav: 420,
          });
        }
        this.floatTexts.push({ x: this.w / 2, y: cy - 30, text: "挖穿！", color: "#ffffff", life: 1, maxLife: 1, size: 22 });
        this.resolveDrill();
      }
    }

    if (this.phase === "descending" && this.phaseTimer <= 0) {
      this.phase = "observe";
      if (this.layer?.hazard === "anomaly" && this.layer.anomalyEffect) {
        this.phase = "anomaly";
      } else {
        this.logAdd(`抵达 ${this.depth}m，观察地层…`, "info");
      }
      this.pushUi();
    }
  }

  private rockFaceY(): number {
    return Math.max(200, this.h * 0.3);
  }

  // ---------------- 快照 ----------------

  private buildSnapshot(): UiSnapshot {
    const l = this.layer;
    const backpack: BackpackItem[] = (Object.keys(this.backpackCount) as OreId[])
      .filter((id) => this.backpackCount[id] > 0)
      .map((id) => ({
        id, name: ORES[id].name, count: this.backpackCount[id],
        color: ORES[id].color, value: Math.round(this.loadValue),
      }));
    const stageName = this.stageName();
    return {
      phase: this.phase,
      depth: this.depth,
      stageName,
      power: Math.round(this.power), maxPower: 100,
      durability: Math.round(this.durability), maxDurability: this.maxDurability,
      overheat: Math.round(this.overheat),
      combo: Math.round(this.combo * 100) / 100,
      supports: this.supports,
      detectors: this.detectors,
      capacity: this.capacity,
      load: Math.round(this.loadValue),
      loadRatio: Math.round(this.loadRatio() * 100) / 100,
      backpack,
      layer: l ? {
        signals: l.signals,
        hardnessText: ["松散", "中等", "坚硬", "极硬", "花岗岩"][l.hardness - 1],
        qualityText: VEIN_NAME[l.quality],
        hazardText: l.hazard ? hazardName(l.hazard) : null,
        collapseRiskLabel: riskLabel(l.collapseRisk),
        revealed: !!l.revealed,
        anomalyEffect: l.anomalyEffect,
        milkingAvailable: this.canMilk(),
        milkCount: this.milkCount,
        stage: l.stage,
      } : null,
      result: null,
      hazard: this.phase === "hazard" ? { type: "creature", severity: this.hazardSeverity } : null,
      anomaly: this.phase === "anomaly" && l?.anomalyEffect ? { text: l.anomalyEffect } : null,
      gameover: this.phase === "gameover" ? { reason: "灾难事故", lost: 0, saved: this.loadValue, depth: this.depth, best: false } : null,
      surfaced: this.phase === "surfaced" ? { banked: this.loadValue, depth: this.depth, totalBanked: this.save.stats.totalBanked, best: false } : null,
      retreatBlocked: this.retreatBlocked > 0,
      log: [...this.log],
      drilling: this.phase === "drilling" ? { progress: this.drillProgress, mode: this.drillMode, hardness: l?.hardness ?? 1 } : null,
      canDrill: this.power > 0,
    };
  }

  private stageName(): string {
    return { shallow: "浅层矿区", oldmine: "旧矿井", magma: "岩浆带", bio: "生物区", abyss: "深渊" }[stageForDepth(this.depth)];
  }

  private pushUi(): void {
    this.cb.onUi(this.buildSnapshot());
  }

  // ---------------- 渲染 ----------------

  private render(): void {
    const ctx = this.ctx;
    const w = this.w, h = this.h;
    ctx.save();
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }
    this.drawBackground(ctx, w, h);
    this.drawCaveSides(ctx, w, h);
    if (this.layer) this.drawRockFace(ctx, w, h);
    this.drawHazards(ctx, w, h);
    this.drawDrill(ctx, w, h);
    this.drawParticles(ctx);
    this.drawFloatTexts(ctx);
    this.drawHUD(ctx, w, h);
    this.drawVignette(ctx, w, h);
    ctx.restore();
    if (this.flash > 0) {
      ctx.fillStyle = this.flashColor;
      ctx.globalAlpha = this.flash * 0.45;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }

  private drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const stage = this.layer ? stageForDepth(this.depth) : "shallow";
    const g = ctx.createLinearGradient(0, 0, 0, h);
    if (stage === "magma") { g.addColorStop(0, "#2a0e05"); g.addColorStop(0.5, "#4a1d10"); g.addColorStop(1, "#7a3012"); }
    else if (stage === "bio") { g.addColorStop(0, "#0d160b"); g.addColorStop(0.5, "#16291a"); g.addColorStop(1, "#24402a"); }
    else if (stage === "abyss") { g.addColorStop(0, "#141006"); g.addColorStop(0.5, "#1e180c"); g.addColorStop(1, "#2e2414"); }
    else if (stage === "oldmine") { g.addColorStop(0, "#2a1a0e"); g.addColorStop(0.5, "#3a2414"); g.addColorStop(1, "#523419"); }
    else { g.addColorStop(0, "#2c2014"); g.addColorStop(0.5, "#3a2a18"); g.addColorStop(1, "#523c20"); }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  private drawCaveSides(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const sway = Math.sin(this.time * 0.05) * 10;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w * 0.18 + sway, 0);
    ctx.lineTo(w * 0.1 + sway, h * 0.5);
    ctx.lineTo(w * 0.2 + sway, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w, 0);
    ctx.lineTo(w * 0.82 - sway, 0);
    ctx.lineTo(w * 0.9 - sway, h * 0.5);
    ctx.lineTo(w * 0.8 - sway, h);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }

  private drawRockFace(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const l = this.layer!;
    const top = this.rockFaceY();
    const bottom = h;
    const rnd = mulberry32(l.index * 7919 + 13);
    const stage = stageForDepth(this.depth);
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    const c1 = stage === "magma" ? "#5a2413" : stage === "bio" ? "#26381f" : stage === "abyss" ? "#26200f" : stage === "oldmine" ? "#4a3019" : "#463723";
    const c2 = stage === "magma" ? "#1c0703" : stage === "bio" ? "#0a1109" : stage === "abyss" ? "#0a0804" : stage === "oldmine" ? "#1c0f06" : "#1b130a";
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, top, w, bottom - top);

    // 岩层条纹：持续向上滚动（钻机向下钻进，岩石从下方源源不断送上来）
    const bandH = 96;
    const scroll = (this.rockScroll * 8) % bandH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, w, bottom - top);
    ctx.clip();
    for (let y = top - scroll; y < bottom; y += bandH) {
      const tint = stage === "magma" ? "255,90,30" : stage === "bio" ? "95,201,143" : stage === "abyss" ? "255,200,87" : stage === "oldmine" ? "224,138,69" : "212,166,92";
      ctx.fillStyle = `rgba(${tint},${0.04 + rnd() * 0.07})`;
      ctx.fillRect(0, y, w, bandH - 8);
      ctx.strokeStyle = "rgba(0,0,0,0.32)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, y + bandH - 8);
      for (let x = 0; x <= w; x += 60) {
        ctx.lineTo(x, y + bandH - 8 + Math.sin(x * 0.02 + y * 0.05) * 3);
      }
      ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      for (let k = 0; k < 8; k++) {
        const sx = rnd() * w;
        const sy = y + 8 + rnd() * (bandH - 20);
        ctx.beginPath();
        ctx.arc(sx, sy, 1.5 + rnd() * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    const crackCount = Math.floor(4 + l.instability * 26);
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < crackCount; i++) {
      const x = rnd() * w;
      const y = top + 20 + rnd() * (bottom - top - 40);
      ctx.beginPath();
      ctx.moveTo(x, y);
      let px = x, py = y;
      const segs = 2 + Math.floor(rnd() * 3);
      for (let s = 0; s < segs; s++) {
        px += (rnd() - 0.5) * 40;
        py += rnd() * 26;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    if (this.oreGlints.length === 0) {
      this.oreGlints = [];
      const count = 14 + Math.floor(rnd() * 18);
      for (let i = 0; i < count; i++) {
        const ore = l.ores[Math.floor(rnd() * l.ores.length)];
        this.oreGlints.push({
          x: rnd() * w,
          y: top + 20 + rnd() * (bottom - top - 40),
          color: ORES[ore].color,
          r: 2 + rnd() * 3,
        });
      }
    }
    for (const glint of this.oreGlints) {
      const pulse = 0.6 + 0.4 * Math.sin(this.time * 2 + glint.x);
      ctx.shadowColor = glint.color;
      ctx.shadowBlur = 12 * pulse;
      ctx.fillStyle = glint.color;
      ctx.globalAlpha = 0.55 + 0.45 * pulse;
      ctx.beginPath();
      ctx.arc(glint.x, glint.y, glint.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.moveTo(0, top);
    for (let x = 0; x <= w; x += 22) {
      ctx.lineTo(x, top + 3 + Math.sin(x * 0.035 + this.time * 0.5) * 3);
    }
    ctx.lineTo(w, top);
    ctx.closePath();
    ctx.fill();

    if (this.wallHole > 0) {
      const cx = w / 2;
      const cy = top + 12 + this.wallHole * 16;
      const r = 24 + this.wallHole * 30;
      const holeGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      holeGrad.addColorStop(0, "#0a0703");
      holeGrad.addColorStop(1, "rgba(10,7,3,0.6)");
      ctx.fillStyle = holeGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,220,150,0.25)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawHazards(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const l = this.layer;
    if (!l) return;
    const top = this.rockFaceY();
    const bottom = h - 40;
    if (l.hazard === "gas") {
      const t = this.time;
      for (let i = 0; i < 5; i++) {
        const x = (w * (0.2 + i * 0.15) + Math.sin(t * 0.3 + i * 2) * 40 + w / 2) % (w * 0.9);
        const y = top + (bottom - top) * (0.25 + 0.12 * Math.sin(t * 0.4 + i * 3));
        const r = 60 + Math.sin(t + i) * 14;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, "rgba(120,255,160,0.16)");
        grad.addColorStop(1, "rgba(120,255,160,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (l.hazard === "heat") {
      const t = this.time;
      const grad = ctx.createLinearGradient(0, top, 0, bottom);
      const a = 0.12 + 0.06 * Math.sin(t * 1.5);
      grad.addColorStop(0, `rgba(255,90,20,${a})`);
      grad.addColorStop(1, "rgba(255,90,20,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, top, w, bottom - top);
    }
    if (l.hazard === "creature") {
      if (this.eyes.length === 0) {
        const rnd = mulberry32(l.index * 104729 + 7);
        for (let i = 0; i < 3 + Math.floor(rnd() * 4); i++) {
          this.eyes.push({
            x: rnd() * w,
            y: top + 30 + rnd() * (bottom - top - 60),
            phase: rnd() * 6,
          });
        }
      }
      for (const e of this.eyes) {
        const blink = Math.sin(this.time * 2 + e.phase) > -0.8 ? 1 : 0.05;
        const eyeW = 9, eyeH = 5;
        ctx.fillStyle = `rgba(255,240,120,${0.75 * blink})`;
        ctx.shadowColor = "#ffe060";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.ellipse(e.x - eyeW / 2, e.y, eyeW, eyeH, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(e.x + eyeW / 2, e.y, eyeW, eyeH, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    if (l.hazard === "anomaly") {
      const t = this.time;
      ctx.strokeStyle = `rgba(95,201,143,${0.25 + 0.1 * Math.sin(t * 2)})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const cx = w / 2 + Math.sin(t + i * 2) * 30;
        const cy = (top + bottom) / 2 + Math.cos(t * 0.7 + i) * 30;
        ctx.beginPath();
        for (let a = 0; a <= Math.PI * 2; a += 0.2) {
          const r = 60 + i * 26 + Math.sin(a * 3 + t * 2 + i) * 8;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          if (a === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  }

  private drawDrill(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const cx = w / 2;
    const active = this.phase === "drilling";
    const jitter = active
      ? Math.sin(this.time * 46) * 2.5 + Math.cos(this.time * 33) * 2
      : Math.sin(this.time * 2) * 1.2;
    const face = this.rockFaceY();
    const push = active ? this.wallHole * 16 : 0;
    const bodyBottom = face - 54 + push;
    const bodyTop = bodyBottom - 56;

    ctx.save();
    ctx.translate(cx + Math.sin(this.time * 2) * 2, 0);

    ctx.strokeStyle = "#6b5638";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, bodyTop + 6);
    ctx.stroke();
    ctx.fillStyle = "#4a3a24";
    ctx.beginPath();
    ctx.roundRect(-36, 4, 72, 24, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(233,187,110,0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.rotate(jitter * 0.01);

    const bodyGrad = ctx.createLinearGradient(-40, bodyTop, 40, bodyBottom);
    bodyGrad.addColorStop(0, "#5c4a33");
    bodyGrad.addColorStop(0.5, "#7d6a4e");
    bodyGrad.addColorStop(1, "#423420");
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.roundRect(-36, bodyTop, 72, 56, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(233,187,110,0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();

    const lightY = bodyBottom - 8;
    const lightGrad = ctx.createRadialGradient(0, lightY, 2, 0, lightY, 34);
    lightGrad.addColorStop(0, active ? "rgba(255,200,87,0.5)" : "rgba(255,200,87,0.22)");
    lightGrad.addColorStop(1, "rgba(255,200,87,0)");
    ctx.fillStyle = lightGrad;
    ctx.beginPath();
    ctx.arc(0, lightY, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = active ? "#ffd166" : "#b98a3e";
    ctx.shadowColor = "#ffc857";
    ctx.shadowBlur = active ? 18 : 8;
    ctx.beginPath();
    ctx.arc(0, lightY, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#3a2e1c";
    ctx.beginPath();
    ctx.roundRect(-14, bodyBottom - 2, 28, 26, 6);
    ctx.fill();

    const bitTop = bodyBottom + 22;
    const bitLen = 30;
    ctx.save();
    ctx.translate(0, bitTop);
    ctx.rotate(active ? this.time * 40 : this.time * 4);
    ctx.fillStyle = "#a89a7e";
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(0, bitLen);
    ctx.lineTo(10, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#d9cba6";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(0, i * 7, 6 - i * 1.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const alpha = Math.max(0, Math.min(1, p.life / (p.maxLife * 0.6)));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (p.type === "spark" || p.type === "ember") {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  private drawFloatTexts(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = "center";
    for (const f of this.floatTexts) {
      const a = Math.max(0, Math.min(1, f.life / (f.maxLife * 0.7)));
      ctx.globalAlpha = a;
      ctx.font = `bold ${f.size}px "Microsoft YaHei", sans-serif`;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  private drawHUD(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const pad = 16;
    ctx.textAlign = "left";
    ctx.font = "bold 30px 'Microsoft YaHei', sans-serif";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#f6ead4";
    ctx.fillText(`${Math.round(this.depthDisplay)}m`, pad, pad + 30);
    ctx.shadowBlur = 0;
    ctx.font = "14px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = "rgba(240,218,178,0.75)";
    ctx.fillText(this.stageName(), pad, pad + 52);

    ctx.textAlign = "right";
    ctx.font = "bold 26px 'Microsoft YaHei', sans-serif";
    ctx.shadowColor = "#ffd166";
    ctx.shadowBlur = 14;
    ctx.fillStyle = this.combo >= 3 ? "#ffd166" : "#ffffff";
    ctx.fillText(`Combo ${fmtCombo(this.combo)}`, w - pad, pad + 26);
    ctx.shadowBlur = 0;
    ctx.font = "bold 18px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = "#5fc98f";
    ctx.fillText(`本轮 ${fmt(this.loadValue)}`, w - pad, pad + 50);
    ctx.textAlign = "left";

    const barX = pad;
    const barW = 14;
    const y0 = 90;
    const barGap = 18;
    const barH = Math.min(220, h * 0.28);
    this.drawBar(ctx, barX, y0, barH, barW, this.durability / this.maxDurability, "#e08a45", "耐久");
    this.drawBar(ctx, barX, y0 + barH + barGap, barH, barW, this.power / 100, "#ffd166", "电量");
    if (this.layer?.stage === "magma") {
      this.drawBar(ctx, barX, y0 + 2 * (barH + barGap), barH, barW, this.overheat / 100, this.overheat > 75 ? "#ff5522" : "#ff8c42", "过热");
    }

    const rx = w - pad - barW;
    const ratio = this.loadRatio();
    const loadColor = ratio > 1.15 ? "#ff5a3c" : ratio > 1 ? "#e0665a" : ratio > 0.8 ? "#f0a23c" : ratio > 0.6 ? "#ffc857" : "#5fc98f";
    this.drawBar(ctx, rx, y0, barH + 60, barW, Math.min(1.4, ratio) / 1.4, loadColor, `负重 ${Math.round(ratio * 100)}%`);

    const iconsY = h - 46;
    ctx.font = "13px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = "rgba(240,218,178,0.8)";
    ctx.fillText(this.supports > 0 ? `支撑架 ×${this.supports}` : "支撑架 无", pad, iconsY);
    ctx.fillText(this.detectors > 0 ? `探测器 ×${this.detectors}` : "探测器 无", pad + 110, iconsY);

    ctx.textAlign = "center";
    ctx.font = "14px 'Microsoft YaHei', sans-serif";
    this.log.slice(-2).forEach((entry, i) => {
      ctx.globalAlpha = 0.55 + 0.45 * (i / 2);
      ctx.fillStyle = entry.kind === "good" ? "#5fc98f" : entry.kind === "bad" ? "#ff8a80" : entry.kind === "warn" ? "#ffc857" : "#e8dcc6";
      ctx.fillText(entry.text, w / 2, h - 16 - (1 - i) * 18);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  }

  private drawBar(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, w: number, ratio: number, color: string, label: string): void {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 7);
    ctx.fill();
    const fillH = Math.max(0, Math.min(1, ratio)) * (h - 4);
    if (fillH > 0) {
      const g = ctx.createLinearGradient(x, y + h, x, y);
      g.addColorStop(0, color);
      g.addColorStop(1, "#ffffff");
      ctx.fillStyle = g;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.roundRect(x + 2, y + h - 2 - fillH, w - 4, fillH, 5);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.save();
    ctx.translate(x + w + 6, y + 10);
    ctx.rotate(Math.PI / 2);
    ctx.font = "11px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = "rgba(240,218,178,0.85)";
    ctx.textAlign = "left";
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  private drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

function riskLabel(risk: number): string {
  if (risk < 0.08) return "极低";
  if (risk < 0.16) return "低";
  if (risk < 0.28) return "中";
  if (risk < 0.42) return "高";
  return "极高";
}
