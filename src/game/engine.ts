import {
  CHECKPOINTS, ORES, backpackStats, detectionStats, drillStats,
  fmt, fmtCombo, persistSave, safetyStats, stageForDepth, supportStats,
} from "./config";
import type { OreId, SaveData } from "./config";
import {
  Layer, VEIN_NAME, generateLayer, hazardName, rollOreYield, upgradeQuality,
} from "./world";
import {
  CONSUMABLES, DIFFICULTY_DEFS, EMPTY_EQUIP_STATS, EQUIPMENT_DEFS,
  ORE_QUALITIES, blackBuyDiscount, blackMarketRepairCost, blackSellRatio,
  computeRating, dailyTasks, dateKey, generateBmStock, makeEquipmentInstance,
  mergeEquipStats, oreStackKey, oreUnitValue as oreUnitValueBase,
} from "./items";
import type {
  BmStockItem, BuffId, Difficulty, EquipmentStats, OreQuality,
} from "./items";
import type {
  BagSlot, BlackMarketView, DailyTaskView, EngineCallbacks, LogEntry,
  RunConfig, RunPhase, RunResult, UiSnapshot,
} from "./types";
import { AudioEngine } from "./audio";

// ---------- 兼容导出：UI 契约来自 types.ts，这里再导出便于过渡期引用 ----------
export type { UiSnapshot, RunConfig, RunResult, BagSlot, BlackMarketView, EngineCallbacks, LogEntry, RunPhase } from "./types";

export type DrillMode = "cautious" | "standard" | "overload";
export type Phase = RunPhase;
export type RunEndKind = "surfaced" | "disaster";

const MILK_MULT = [1, 1.5, 2.2, 3.5];
const MILK_RISK = [0.1, 0.2, 0.35, 0.55];

// 穿透：一次钻进有一定概率一次钻穿多层，上限 10 层，概率逐层递减
const PENETRATE_BASE: Record<DrillMode, number> = { cautious: 0.04, standard: 0.1, overload: 0.2 };
const PENETRATE_DECAY = 0.55;
const PENETRATE_CAP = 10;

// 黑市固定出现点（检查点层）
const BM_DEPTHS = [100, 300, 600, 1000];

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

type GainedOre = { id: OreId; quality: OreQuality; count: number };

export class MinerGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private audio: AudioEngine;
  private cb: EngineCallbacks;
  private save: SaveData;
  private config: RunConfig = { difficulty: "normal", pocket: 0, buffs: [], equipment: [], items: [] };
  private equipStats: EquipmentStats = { ...EMPTY_EQUIP_STATS };
  private raf = 0;
  private lastTime = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;

  phase: RunPhase = "idle";
  private depth = 0;
  private layer: Layer | null = null;
  private power = 100;
  private maxPower = 100;
  private durability = 100;
  private maxDurability = 100;
  private overheat = 0;
  private combo = 1;
  private supports = 0;
  private detectors = 0;
  private slots = 5;
  private bag: BagSlot[] = [];
  private loadValue = 0;
  private pocket = 0;
  private difficulty: Difficulty = "normal";
  private buffs: BuffId[] = [];
  private gasImmune = false;
  private shieldActive = false;
  private pierceBuff = 0;
  private qualityBonus = 0;
  private valueBonus = 0;
  private wearReduce = 0;
  private banditReduce = 0;
  private canBlackMarket = false;
  private bmStock: BmStockItem[] = [];
  private milkCount = 0;
  private supportsUsedThisLayer = false;
  private retreatBlocked = 0;
  private anomalyDouble = false;
  private anomalyDoubleLoss = false;
  private detectorDisabled = false;
  private megaShieldUsed = false;
  private nextTransparent = false;
  private banditSeverity = 1;
  private runEnded = false;
  private minedThisRun = 0;
  private scaredThisRun = 0;

  private lastResult: UiSnapshot["result"] | null = null;
  private resultOres: BagSlot[] = [];
  private gameoverInfo: UiSnapshot["gameover"] | null = null;
  private surfacedInfo: UiSnapshot["surfaced"] | null = null;
  private log: LogEntry[] = [];
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

  startRun(startDepth: number, save: SaveData, config: RunConfig): void {
    this.save = save;
    this.config = config;
    this.difficulty = config.difficulty;
    this.pocket = Math.max(0, config.pocket);
    this.buffs = [...config.buffs];
    this.depth = startDepth;
    this.depthDisplay = startDepth;
    this.overheat = 0;
    this.combo = 1;
    this.milkCount = 0;
    this.retreatBlocked = 0;
    this.anomalyDouble = false;
    this.anomalyDoubleLoss = false;
    this.detectorDisabled = false;
    this.megaShieldUsed = false;
    this.nextTransparent = false;
    this.runEnded = false;
    this.minedThisRun = 0;
    this.scaredThisRun = 0;
    this.canBlackMarket = false;
    this.bmStock = [];
    this.bag = [];
    this.loadValue = 0;
    this.lastResult = null;
    this.resultOres = [];
    this.gameoverInfo = null;
    this.surfacedInfo = null;
    this.particles = [];
    this.floatTexts = [];
    this.log = [];

    // 装备加成汇总
    this.equipStats = mergeEquipStats(...config.equipment.map((e) => EQUIPMENT_DEFS[e.id]?.stats));
    this.qualityBonus = (this.hasBuff("quality") ? 15 : 0) + this.equipStats.qualityBonus;
    this.valueBonus = this.equipStats.valueBonus;
    this.wearReduce = (this.hasBuff("wear_less") ? 30 : 0) + this.equipStats.wearReduce;
    this.pierceBuff = (this.hasBuff("pierce") ? 5 : 0) + this.equipStats.pierceBonus;
    this.banditReduce = this.equipStats.banditReduce;
    this.gasImmune = this.hasBuff("gas");
    this.shieldActive = this.hasBuff("shield");

    const ds = drillStats(save.upgrades.drill);
    this.maxDurability = ds.maxDurability;
    this.durability = ds.maxDurability;
    this.maxPower = this.hasBuff("fuel") ? 140 : 100;
    this.power = this.maxPower;

    const bs = backpackStats(save.upgrades.backpack);
    this.slots = bs.slots + this.equipStats.slotBonus + (this.hasBuff("slots") ? 2 : 0);
    const ss = supportStats(save.upgrades.support);
    this.supports = ss.supports;
    const det = detectionStats(save.upgrades.detection);
    this.detectors = det.detectors + this.equipStats.detectorBonus;

    // 携带的消耗品入包（格子不够则散落损失）
    for (const itemId of config.items) {
      const def = CONSUMABLES[itemId];
      if (!def || def.kind !== "consumable") continue;
      if (this.usedSlots() >= this.slots) {
        this.logAdd(`背包已满，${def.name} 散落损失`, "warn");
        continue;
      }
      this.bag.push({
        key: "item:" + itemId, kind: "item", id: itemId, count: 1,
        name: def.name, color: def.color, icon: def.icon, value: 0, unitValue: 0,
      });
    }

    const accuracy = Math.min(1, det.accuracy + this.equipStats.accuracyBonus / 100);
    this.layer = this.genLayer(startDepth, accuracy);
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

  useItem(slotKey: string): void {
    if (this.phase !== "observe" && this.phase !== "result" && this.phase !== "blackmarket") return;
    const idx = this.bag.findIndex((s) => s.key === slotKey);
    if (idx < 0) return;
    const slot = this.bag[idx];
    if (slot.kind !== "item") return;
    const def = CONSUMABLES[slot.id];
    if (!def || def.effect === undefined) return;
    switch (def.effect) {
      case "repair":
        this.durability = Math.min(this.maxDurability, this.durability + this.maxDurability * 0.4);
        this.logAdd(`${def.name}：耐久 +40%`, "good");
        break;
      case "fuel":
        this.power = Math.min(this.maxPower, this.power + 40);
        this.logAdd(`${def.name}：电量 +40`, "good");
        break;
      case "shield":
        this.shieldActive = true;
        this.logAdd(`${def.name}：已激活，抵挡一次灾难`, "good");
        break;
      case "purify":
        this.gasImmune = true;
        this.logAdd(`${def.name}：本局免疫毒气`, "good");
        break;
      case "pierce":
        this.pierceBuff += 8;
        this.logAdd(`${def.name}：穿透概率 +8%`, "good");
        break;
    }
    this.bag.splice(idx, 1);
    this.audio.play("support");
    this.pushUi();
  }

  discardSlot(slotKey: string): void {
    if (this.phase !== "result" && this.phase !== "observe" && this.phase !== "blackmarket") return;
    const idx = this.bag.findIndex((s) => s.key === slotKey);
    if (idx < 0) return;
    const slot = this.bag[idx];
    if (slot.kind === "ore") this.loadValue = Math.max(0, this.loadValue - slot.value);
    this.logAdd(`丢弃 ${slot.name}${slot.kind === "ore" ? " ×" + slot.count : ""}`, "warn");
    this.bag.splice(idx, 1);
    this.audio.play("click");
    this.pushUi();
  }

  retreat(): void {
    if (this.phase !== "observe" && this.phase !== "result") return;
    if (this.retreatBlocked > 0) {
      this.logAdd(`撤退通道被封锁，还需继续 ${this.retreatBlocked} 层`, "bad");
      return;
    }
    this.finishRun();
  }

  emergencyRetreat(): void {
    if (this.phase !== "hazard") return;
    const ss = safetyStats(this.save.upgrades.safety);
    const overload = this.slotRatio() >= 1 ? 0.12 : 0;
    if (Math.random() < ss.retreatSuccess - overload) {
      this.logAdd("紧急撤退成功！", "good");
      this.finishRun();
    } else {
      const lost = this.removeOreValue(0.15);
      this.durability = Math.max(0, this.durability - 15);
      this.audio.play("accident");
      this.logAdd(`紧急撤退受挫，损失了 ${fmt(lost)} 矿石`, "bad");
      this.finishRun();
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
          this.scaredThisRun++;
          const d = this.ensureDaily();
          d.tasks.task_creature = (d.tasks.task_creature ?? 0) + 1;
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
    if (this.runEnded) return;
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
    const baseCount = 2 + Math.floor(Math.random() * 2);
    const yields = rollOreYield(this.depth, this.layer.ores, this.layer.quality, baseCount);
    const gained = this.scaleYields(yields, mult, this.combo);
    const added = this.addOresToBag(gained, []);
    const value = added.reduce((s, a) => s + this.oreUnitValue(a.id, a.quality) * a.count, 0);
    this.milkCount++;
    this.audio.play("milking");
    this.logAdd(`榨取矿脉 +${fmt(value)}（第 ${this.milkCount} 次）`, "good");
    const risk = Math.min(0.85, this.baseRisk() + extraRisk + (this.slotRatio() >= 1 ? 0.08 : 0));
    if (Math.random() < risk) {
      this.audio.play("warning");
      this.logAdd("榨取时岩层剧烈震动……", "warn");
      this.applyAccident(this.rollSeverity(risk));
    }
    if (this.runEnded) return;
    this.pushUi();
  }

  continueDescend(): void { if (this.phase === "result") this.advanceLayer(); }

  anomalyContinue(): void {
    if (this.phase !== "anomaly") return;
    this.phase = "observe";
    this.pushUi();
  }

  skipDrill(): void {
    if (this.phase !== "drilling") return;
    this.drillProgress = 1;
    this.audio.play("click");
  }

  // ---------------- 黑市 ----------------

  openBlackMarket(): void {
    if (this.phase !== "result" || !this.canBlackMarket) return;
    const favor = Math.min(5, this.save.favor + (this.hasBuff("favor") ? 1 : 0));
    this.bmStock = generateBmStock(this.depth, favor, {
      sellBoost: this.hasBuff("sell_boost"),
      discount: this.hasBuff("bm_discount"),
    });
    this.phase = "blackmarket";
    this.audio.play("click");
    this.pushUi();
  }

  bmSell(slotKey: string, count: number): void {
    if (this.phase !== "blackmarket") return;
    const idx = this.bag.findIndex((s) => s.key === slotKey);
    if (idx < 0) return;
    const slot = this.bag[idx];
    if (slot.kind !== "ore" || slot.quality === undefined) return;
    const sell = Math.max(1, Math.min(count, slot.count));
    const favor = Math.min(5, this.save.favor + (this.hasBuff("favor") ? 1 : 0));
    const ratio = blackSellRatio(favor, this.hasBuff("sell_boost"));
    const cash = Math.round(sell * slot.unitValue * ratio);
    if (cash <= 0) return;
    this.pocket += cash;
    slot.count -= sell;
    slot.value = slot.count * slot.unitValue;
    this.loadValue = Math.max(0, this.loadValue - sell * slot.unitValue);
    if (slot.count <= 0) this.bag.splice(idx, 1);
    this.save.stats.totalSells += sell;
    const d = this.ensureDaily();
    d.tasks.task_sell = (d.tasks.task_sell ?? 0) + sell;
    this.logAdd(`黑市售出 ${slot.name} ×${sell}，+${fmt(cash)}`, "good");
    this.audio.play("click");
    persistSave(this.save);
    this.pushUi();
  }

  bmBuy(index: number, pay: "cash" | "ore"): void {
    if (this.phase !== "blackmarket") return;
    const item = this.bmStock[index];
    if (!item) return;
    if (item.kind === "consumable" && this.usedSlots() >= this.slots) {
      this.logAdd("背包已满，无法购买", "warn");
      this.audio.play("warning");
      return;
    }
    if (pay === "cash") {
      if (this.pocket < item.cashPrice) {
        this.logAdd("随身现金不足", "bad");
        return;
      }
      this.pocket -= item.cashPrice;
    } else {
      const key = oreStackKey(item.oreCost.id, item.oreCost.quality);
      const slot = this.bag.find((s) => s.key === key);
      if (!slot || slot.kind !== "ore" || slot.count < item.oreCost.count) {
        this.logAdd(`缺少 ${ORE_QUALITIES[item.oreCost.quality].name}${ORES[item.oreCost.id].name} ×${item.oreCost.count}`, "bad");
        return;
      }
      slot.count -= item.oreCost.count;
      slot.value = slot.count * slot.unitValue;
      this.loadValue = Math.max(0, this.loadValue - item.oreCost.count * slot.unitValue);
      if (slot.count <= 0) this.bag.splice(this.bag.indexOf(slot), 1);
    }
    if (item.kind === "consumable") {
      this.bag.push({
        key: "item:" + item.id, kind: "item", id: item.id, count: 1,
        name: item.name, color: item.color, icon: item.icon, value: 0, unitValue: 0,
      });
      this.logAdd(`购入 ${item.name}`, "good");
    } else {
      const inst = makeEquipmentInstance(item.id);
      this.save.warehouseEquipment.push(inst);
      this.logAdd(`购入装备 ${item.name}（已存入装备仓库）`, "good");
    }
    this.audio.play("click");
    persistSave(this.save);
    this.pushUi();
  }

  bmRepair(): void {
    if (this.phase !== "blackmarket") return;
    const cost = blackMarketRepairCost(this.maxDurability);
    if (this.pocket < cost) {
      this.logAdd("随身现金不足，无法维修", "bad");
      return;
    }
    this.pocket -= cost;
    this.durability = Math.min(this.maxDurability, this.durability + this.maxDurability * 0.4);
    this.logAdd("黑市维修完成：耐久 +40%", "good");
    this.audio.play("support");
    persistSave(this.save);
    this.pushUi();
  }

  bmClaimTask(taskId: string): void {
    if (this.phase !== "blackmarket") return;
    const daily = this.ensureDaily();
    const task = dailyTasks(daily.date).find((t) => t.id === taskId);
    if (!task || daily.claimed[taskId]) return;
    if ((daily.tasks[taskId] ?? 0) < task.target) return;
    daily.claimed[taskId] = true;
    this.save.favor = Math.min(5, this.save.favor + 1);
    this.logAdd("任务完成！好感 +1", "good");
    this.audio.play("success");
    persistSave(this.save);
    this.pushUi();
  }

  bmLeave(): void {
    if (this.phase !== "blackmarket") return;
    this.phase = "result";
    this.bmStock = [];
    this.pushUi();
  }

  // ---------------- 强盗 ----------------

  banditChoice(action: "pay" | "give" | "fight"): void {
    if (this.phase !== "bandit") return;
    const reduce = 1 - this.banditReduce / 100;
    if (action === "pay") {
      const cost = Math.round(this.pocket * 0.1 * reduce);
      this.pocket = Math.max(0, this.pocket - cost);
      this.logAdd(`强盗勒索：支付 ${fmt(cost)} 现金`, "warn");
    } else if (action === "give") {
      const lost = this.removeOreValue(0.12 * reduce);
      this.logAdd(`强盗抢走价值 ${fmt(lost)} 的矿石`, "bad");
    } else {
      if (Math.random() < 0.5) {
        this.logAdd("你击退了强盗！", "good");
      } else {
        const lost = this.removeOreValue(0.25 * reduce);
        this.logAdd(`战斗失败！损失价值 ${fmt(lost)} 的矿石`, "bad");
        this.durability = Math.max(0, this.durability - 10);
      }
    }
    this.audio.play("accident");
    this.phase = "result";
    this.pushUi();
  }
  // ---------------- 内部逻辑 ----------------

  private hasBuff(id: BuffId): boolean {
    return this.buffs.includes(id);
  }

  private usedSlots(): number {
    return this.bag.length;
  }

  private slotRatio(): number {
    return this.slots > 0 ? this.usedSlots() / this.slots : 0;
  }

  private canMilk(): boolean {
    return !!this.layer && (this.layer.quality === "rich" || this.layer.quality === "legendary") && this.milkCount < 4;
  }

  // 损耗惩罚：每损失 25% 耐久 -10% 性能，上限 30%（温和难度不生效）
  private get wearPenalty(): number {
    if (!DIFFICULTY_DEFS[this.difficulty].wear) return 0;
    const lossRatio = 1 - this.durability / Math.max(1, this.maxDurability);
    return Math.min(0.3, Math.max(0, 0.1 * Math.floor(lossRatio / 0.25)));
  }

  private oreUnitValue(id: OreId, quality: OreQuality): number {
    return oreUnitValueBase(this.depth, id, quality) * (1 + this.valueBonus / 100);
  }

  private oreSlotName(id: OreId, quality: OreQuality): string {
    return ORE_QUALITIES[quality].name + ORES[id].name;
  }

  private logAdd(text: string, kind: LogEntry["kind"] = "info"): void {
    this.log.push({ text, kind });
    if (this.log.length > 6) this.log.shift();
  }

  // 把产出按 oreId+quality 聚合，数量受 mode/combo/难度收益/损耗惩罚缩放
  private scaleYields(base: Array<{ id: OreId; quality: OreQuality }>, mult: number, combo: number): GainedOre[] {
    const diff = DIFFICULTY_DEFS[this.difficulty];
    let count = Math.round(base.length * mult * combo * diff.incomeMult * (1 - this.wearPenalty));
    count = Math.max(1, Math.min(99, count));
    const map = new Map<string, GainedOre>();
    for (let i = 0; i < count; i++) {
      const y = base[i % base.length];
      let q = y.quality;
      if (this.qualityBonus > 0 && Math.random() * 100 < this.qualityBonus) q = upgradeQuality(q);
      const key = oreStackKey(y.id, q);
      const cur = map.get(key);
      if (cur) cur.count++;
      else map.set(key, { id: y.id, quality: q, count: 1 });
    }
    return [...map.values()];
  }

  // 入包：同 oreId+quality 叠到 99/格，格子不够的部分散落损失
  private addOreToBag(id: OreId, quality: OreQuality, count: number): number {
    const key = oreStackKey(id, quality);
    const unit = this.oreUnitValue(id, quality);
    let remaining = count;
    const slot = this.bag.find((s) => s.key === key);
    if (slot) {
      const add = Math.min(remaining, 99 - slot.count);
      slot.count += add;
      slot.value = slot.count * unit;
      this.loadValue += add * unit;
      this.minedThisRun += add;
      remaining -= add;
    }
    while (remaining > 0) {
      if (this.usedSlots() >= this.slots) break;
      const add = Math.min(remaining, 99);
      this.bag.push({
        key, kind: "ore", id, quality, count: add,
        name: this.oreSlotName(id, quality),
        color: ORE_QUALITIES[quality].color,
        icon: ORE_QUALITIES[quality].icon,
        value: add * unit, unitValue: unit,
      });
      this.loadValue += add * unit;
      this.minedThisRun += add;
      remaining -= add;
    }
    return remaining;
  }

  private addOresToBag(gained: GainedOre[], events: string[]): GainedOre[] {
    const before = new Map<string, number>();
    for (const s of this.bag) if (s.kind === "ore") before.set(s.key, s.count);
    let lost = 0;
    for (const g of gained) {
      const notAdded = this.addOreToBag(g.id, g.quality, g.count);
      lost += notAdded;
    }
    const addedMap = new Map<string, GainedOre>();
    for (const s of this.bag) {
      if (s.kind !== "ore" || s.quality === undefined) continue;
      const b = before.get(s.key) ?? 0;
      if (s.count > b) addedMap.set(s.key, { id: s.id as OreId, quality: s.quality, count: s.count - b });
    }
    if (lost > 0) {
      this.logAdd(`背包已满，${lost} 个矿石散落损失`, "warn");
      events.push(`背包已满：${lost} 个矿石散落损失`);
    }
    return [...addedMap.values()];
  }

  private toBagSlots(added: GainedOre[]): BagSlot[] {
    return added.map((a) => {
      const unit = this.oreUnitValue(a.id, a.quality);
      return {
        key: oreStackKey(a.id, a.quality),
        kind: "ore",
        id: a.id,
        quality: a.quality,
        count: a.count,
        name: this.oreSlotName(a.id, a.quality),
        color: ORE_QUALITIES[a.quality].color,
        icon: ORE_QUALITIES[a.quality].icon,
        value: Math.round(a.count * unit),
        unitValue: Math.round(unit),
      };
    });
  }

  private mergeBagSlots(list: BagSlot[]): BagSlot[] {
    const map = new Map<string, BagSlot>();
    for (const s of list) {
      const cur = map.get(s.key);
      if (cur) {
        cur.count += s.count;
        cur.value += s.value;
      } else {
        map.set(s.key, { ...s });
      }
    }
    return [...map.values()];
  }

  // 按价值移除矿石（先移除单价最低的堆），返回移除价值
  private removeOreValue(ratio: number): number {
    const target = this.loadValue * ratio;
    let removed = 0;
    const stacks = this.bag
      .filter((s) => s.kind === "ore")
      .sort((a, b) => a.unitValue - b.unitValue);
    for (const s of stacks) {
      if (removed >= target) break;
      const need = target - removed;
      const take = Math.min(s.count, Math.max(1, Math.floor(need / Math.max(1, s.unitValue))));
      if (take <= 0) continue;
      s.count -= take;
      s.value = s.count * s.unitValue;
      removed += take * s.unitValue;
      if (s.count <= 0) this.bag.splice(this.bag.indexOf(s), 1);
    }
    this.loadValue = Math.max(0, this.loadValue - removed);
    return Math.round(removed);
  }

  private genLayer(depth: number, accuracy: number): Layer {
    const l = generateLayer(depth, { accuracy });
    if (this.nextTransparent) {
      l.revealed = { collapseRisk: l.collapseRisk, quality: l.quality, hazard: l.hazard };
      this.nextTransparent = false;
    }
    return l;
  }

  private advanceLayer(): void {
    this.depth += 10;
    this.milkCount = 0;
    this.supportsUsedThisLayer = false;
    this.detectorDisabled = false;
    this.anomalyDouble = false;
    this.anomalyDoubleLoss = false;
    this.unlockCheckpoints();
    const d = this.ensureDaily();
    d.tasks.task_depth = Math.max(d.tasks.task_depth ?? 0, this.depth);
    const det = detectionStats(this.save.upgrades.detection);
    this.layer = this.genLayer(this.depth, Math.min(1, det.accuracy + this.equipStats.accuracyBonus / 100));
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
      else if (e.includes("深渊回响")) this.nextTransparent = true;
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
    const r = this.slotRatio();
    if (r >= 1) risk += 0.12;
    else if (r > 0.8) risk += 0.06;
    else if (r > 0.6) risk += 0.03;
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
    if (this.shieldActive) {
      this.shieldActive = false;
      this.audio.play("megaShield");
      this.logAdd("应急护盾替你抵挡了灾难！", "good");
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
    const saved = Math.round(this.loadValue);
    const depthAt = this.depth;
    // 救援带回的矿石入库（剩余背包矿石即"被救回"的部分）
    for (const slot of this.bag) {
      if (slot.kind !== "ore" || slot.quality === undefined) continue;
      const key = oreStackKey(slot.id as OreId, slot.quality);
      this.save.warehouseOres[key] = (this.save.warehouseOres[key] ?? 0) + slot.count;
    }
    // 随身现金：50% 损失，50% 回归仓库
    const pocketLost = Math.round(this.pocket * 0.5);
    const pocketReturn = Math.round(this.pocket) - pocketLost;
    this.save.cash += pocketReturn;
    // 统计
    const wasBest = saved > this.save.stats.bestRunValue;
    this.save.stats.runs++;
    this.save.stats.disasters++;
    this.save.stats.totalBanked += saved;
    this.save.stats.bestRunValue = Math.max(this.save.stats.bestRunValue, saved);
    this.save.stats.bestDepth = Math.max(this.save.stats.bestDepth, depthAt);
    this.save.stats.totalMined += this.minedThisRun;
    persistSave(this.save);
    this.phase = "gameover";
    this.runEnded = true;
    this.audio.stopDrill();
    this.audio.play("disaster");
    this.shake = Math.max(this.shake, 22);
    this.flash = 0.9;
    this.flashColor = "#ff2200";
    this.logAdd(`灾难事故！损失 ${fmt(lost)}，救援队带回 ${fmt(saved)}`, "bad");
    this.gameoverInfo = {
      reason: "灾难事故",
      lost: Math.round(lost),
      saved,
      depth: depthAt,
      best: wasBest,
      pocketLost,
    };
    const snap = this.buildSnapshot();
    this.cb.onUi(snap);
    this.cb.onRunEnd({ kind: "disaster", banked: saved, depth: depthAt, best: wasBest, rating: null, bonus: 0, save: this.save });
  }

  private finishRun(): void {
    if (this.runEnded) return;
    const banked = Math.round(this.loadValue);
    const depthAt = this.depth;
    // 背包矿石入库；消耗品回仓库；随身现金回归
    for (const slot of this.bag) {
      if (slot.kind === "ore" && slot.quality !== undefined) {
        const key = oreStackKey(slot.id as OreId, slot.quality);
        this.save.warehouseOres[key] = (this.save.warehouseOres[key] ?? 0) + slot.count;
      } else if (slot.kind === "item") {
        this.save.warehouseItems[slot.id] = (this.save.warehouseItems[slot.id] ?? 0) + 1;
      }
    }
    const pocketReturn = Math.round(this.pocket);
    this.save.cash += pocketReturn;
    // 评级：深度 × 货值 × 生存完整度（只奖励现金）
    const rating = computeRating(depthAt, banked, this.durability / Math.max(1, this.maxDurability), this.difficulty);
    const bonusCash = rating.bonusCash;
    this.save.cash += bonusCash;
    const wasBest = banked > this.save.stats.bestRunValue;
    this.save.stats.runs++;
    this.save.stats.totalBanked += banked;
    this.save.stats.bestRunValue = Math.max(this.save.stats.bestRunValue, banked);
    this.save.stats.bestDepth = Math.max(this.save.stats.bestDepth, depthAt);
    this.save.stats.totalMined += this.minedThisRun;
    persistSave(this.save);
    this.runEnded = true;
    this.audio.stopDrill();
    this.audio.play("success");
    this.phase = "surfaced";
    this.logAdd(`安全返回地面，共入库 ${fmt(banked)}`, "good");
    this.surfacedInfo = {
      banked,
      depth: depthAt,
      totalBanked: this.save.stats.totalBanked,
      best: wasBest,
      rating: rating.grade,
      bonusCash,
      pocketReturn,
    };
    const snap = this.buildSnapshot();
    this.cb.onUi(snap);
    this.cb.onRunEnd({ kind: "surfaced", banked, depth: depthAt, best: wasBest, rating: rating.grade, bonus: bonusCash, save: this.save });
  }

  private maybeDropItem(): { name: string; icon: string } | null {
    if (Math.random() >= 0.08) return null;
    const ids = Object.keys(CONSUMABLES);
    const id = ids[Math.floor(Math.random() * ids.length)];
    const def = CONSUMABLES[id];
    if (!def) return null;
    if (this.usedSlots() >= this.slots) {
      this.logAdd("背包已满，掉落的道具散落损失", "warn");
      return null;
    }
    this.bag.push({
      key: "item:" + id, kind: "item", id, count: 1,
      name: def.name, color: def.color, icon: def.icon, value: 0, unitValue: 0,
    });
    this.logAdd(`拾取道具：${def.name}`, "good");
    return { name: def.name, icon: def.icon };
  }

  // 矿石异变：随机一叠矿石价值 +10%
  private applyOreMutation(): number {
    const ores = this.bag.filter((s) => s.kind === "ore");
    if (ores.length === 0) return 0;
    const slot = ores[Math.floor(Math.random() * ores.length)];
    slot.unitValue = slot.unitValue * 1.1;
    const newVal = slot.count * slot.unitValue;
    const delta = newVal - slot.value;
    slot.value = newVal;
    this.loadValue = Math.max(0, this.loadValue + delta);
    return delta;
  }

  private rollPenetration(): number {
    const bonus = Math.min(0.08, 0.006 * this.save.upgrades.drill) + this.pierceBuff / 100;
    const base = (PENETRATE_BASE[this.drillMode] + bonus) * (1 - this.wearPenalty);
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

  private ensureDaily(): SaveData["daily"] {
    const today = dateKey();
    if (this.save.daily.date !== today) {
      this.save.daily = { date: today, tasks: {}, claimed: {} };
    }
    return this.save.daily;
  }

  private buildBmView(): BlackMarketView {
    const favor = Math.min(5, this.save.favor + (this.hasBuff("favor") ? 1 : 0));
    const daily = this.ensureDaily();
    daily.tasks.task_depth = Math.max(daily.tasks.task_depth ?? 0, this.depth);
    const tasks: DailyTaskView[] = dailyTasks(daily.date).map((t) => ({
      id: t.id,
      desc: t.desc,
      progress: daily.tasks[t.id] ?? 0,
      target: t.target,
      claimed: !!daily.claimed[t.id],
      reward: "好感 +1",
    }));
    return {
      sellRatio: blackSellRatio(favor, this.hasBuff("sell_boost")),
      buyDiscount: blackBuyDiscount(favor, this.hasBuff("bm_discount")),
      stock: this.bmStock,
      repairCost: blackMarketRepairCost(this.maxDurability),
      repairPct: 40,
      favor: this.save.favor,
      tasks,
      pocket: Math.round(this.pocket),
      slots: this.slots,
      usedSlots: this.usedSlots(),
      bag: this.bag.map((s) => ({ ...s })),
      depth: this.depth,
    };
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
    let droppedItem: { name: string; icon: string } | null = null;
    let interruptHazard = false;
    let interruptBandit = false;
    this.resultOres = [];

    for (let i = 0; i < layers; i++) {
      const l = this.layer!;
      const isFirst = i === 0;
      const double = isFirst ? this.anomalyDouble : !!l.anomalyEffect?.includes("双倍法则");
      const comboBefore = this.combo;
      const yields = rollOreYield(this.depth, l.ores, l.quality);
      let gained = this.scaleYields(yields, modeMult, comboBefore);
      if (double) {
        gained = gained.map((g) => ({ ...g, count: Math.min(99, g.count * 2) }));
        this.logAdd("深渊双倍法则：本层收益翻倍！", "good");
      }
      const added = this.addOresToBag(gained, events);
      this.resultOres = this.resultOres.concat(this.toBagSlots(added));
      const value = added.reduce((s, a) => s + this.oreUnitValue(a.id, a.quality) * a.count, 0);
      totalValue += value;

      this.combo = Math.min(5, this.combo + comboDelta);

      const powerBase = (7 + l.hardness * 1.6) * (mode === "cautious" ? 1.2 : mode === "standard" ? 1 : 1.5);
      const heatMult = 1 + this.overheat * 0.003;
      this.power = Math.max(0, this.power - powerBase * heatMult);

      // 温和难度无设备损耗
      if (DIFFICULTY_DEFS[this.difficulty].wear) {
        const wearRed = 1 - this.wearReduce / 100;
        const durLoss = (5 + l.hardness * 2) * (mode === "cautious" ? 0.7 : mode === "standard" ? 1 : 1.6)
          * ds.durabilityLossMult * (1 + this.overheat * 0.004) * wearRed;
        this.durability = Math.max(0, this.durability - durLoss);
      }

      if (l.stage === "magma") {
        const heatGain = (12 + 8 * l.hazardSeverity) * (mode === "cautious" ? 0.45 : mode === "standard" ? 1 : 1.65);
        this.overheat = Math.min(100, this.overheat + heatGain);
        if (mode === "cautious") this.overheat = Math.max(0, this.overheat - 8);
        if (this.overheat >= 100) {
          if (DIFFICULTY_DEFS[this.difficulty].wear) {
            this.durability = Math.max(0, this.durability - 8);
          }
          events.push("设备过热！耐久持续下降");
        }
      }

      if (l.hazard === "gas" && Math.random() < 0.65) {
        if (this.gasImmune) {
          events.push("防毒面罩生效，毒气无效");
        } else {
          const ss = safetyStats(this.save.upgrades.safety);
          const drain = (16 + 10 * l.hazardSeverity) * (1 - ss.gasResist);
          this.power = Math.max(0, this.power - drain);
          this.audio.play("warning");
          events.push(`毒气泄漏！电量 -${Math.round(drain)}`);
        }
      }

      if (l.anomalyEffect?.includes("矿石异变")) {
        const boost = this.applyOreMutation();
        if (boost > 0) events.push(`矿石异变：背包价值 +${fmt(boost)}`);
      }
      if (!isFirst && l.anomalyEffect?.includes("单行道")) {
        this.retreatBlocked += 2;
        events.push("单行道：撤退通道被封锁");
      }

      // 道具掉落：每层 8%，只展示第一件
      if (!droppedItem) droppedItem = this.maybeDropItem();

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
        this.audio.play("creature");
        this.logAdd("一头地底生物挡住了去路……", "warn");
        interruptHazard = true;
        break;
      }

      // 强盗（硬核）：每层 12% 概率，出现在钻完该层之后
      if (this.difficulty === "hardcore" && !severity && Math.random() < DIFFICULTY_DEFS.hardcore.banditChance) {
        interruptBandit = true;
        break;
      }

      if (this.power <= 0 || this.durability <= 0) {
        this.endByDisaster();
        return;
      }

      if (interrupted) break;

      if (i < layers - 1) {
        this.depth += 10;
        const det = detectionStats(this.save.upgrades.detection);
        this.layer = this.genLayer(this.depth, Math.min(1, det.accuracy + this.equipStats.accuracyBonus / 100));
        this.milkCount = 0;
      }
    }

    this.unlockCheckpoints();
    const d = this.ensureDaily();
    d.tasks.task_depth = Math.max(d.tasks.task_depth ?? 0, this.depth);
    this.milkCount = 0;
    this.supportsUsedThisLayer = false;
    this.detectorDisabled = false;
    this.anomalyDouble = false;
    this.anomalyDoubleLoss = false;

    // 检查点层必出黑市 + 每层 15% 随机黑市
    this.canBlackMarket = BM_DEPTHS.includes(this.depth) || Math.random() < 0.15;

    if (layers > 1) {
      this.floatTexts.push({
        x: this.w / 2, y: this.rockFaceY() - 60,
        text: `穿透 ×${layers}!`, color: "#ffc857", life: 1.3, maxLife: 1.3, size: 26,
      });
      this.audio.play("success");
    }

    const milkRewardMult = this.canMilk() ? MILK_MULT[Math.min(this.milkCount, MILK_MULT.length - 1)] : null;
    this.lastResult = {
      ores: this.mergeBagSlots(this.resultOres),
      value: Math.round(totalValue),
      comboDelta: Math.round(comboDelta * 100) / 100,
      events,
      canMilk: this.canMilk(),
      milkRewardMult,
      layers,
      canBlackMarket: this.canBlackMarket,
      droppedItem,
    };

    if (interruptHazard) {
      this.phase = "hazard";
      this.pushUi();
      return;
    }
    if (interruptBandit) {
      this.banditSeverity = 1 + Math.floor(Math.random() * 3);
      this.phase = "bandit";
      this.audio.play("creature");
      this.logAdd("强盗拦住了去路！", "bad");
      this.pushUi();
      return;
    }
    this.phase = "result";
    this.pushUi();
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

    this.rockSwoosh = Math.max(0, this.rockSwoosh - dt * 1.5);
    // 观察/选择阶段岩层保持静止，只有钻机旋转；换层下落与钻进时岩层滚动
    if (this.phase === "descending" || this.phase === "drilling") {
      this.rockScroll += dt * (this.rockSwoosh * 420 + (this.phase === "drilling" ? 60 : 0));
    }
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

    if (this.phase !== "drilling" && this.phase !== "observe" && Math.random() < dt * 6) {
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
    return {
      phase: this.phase,
      depth: this.depth,
      stageName: this.stageName(),
      power: Math.round(this.power), maxPower: this.maxPower,
      durability: Math.round(this.durability), maxDurability: this.maxDurability,
      overheat: Math.round(this.overheat),
      combo: Math.round(this.combo * 100) / 100,
      supports: this.supports,
      detectors: this.detectors,
      slots: this.slots,
      usedSlots: this.usedSlots(),
      bag: this.bag.map((s) => ({ ...s })),
      load: Math.round(this.loadValue),
      pocket: Math.round(this.pocket),
      difficulty: this.difficulty,
      wearPenalty: Math.round(this.wearPenalty * 100) / 100,
      buffs: [...this.buffs],
      canBlackMarket: this.canBlackMarket,
      blackmarket: this.phase === "blackmarket" ? this.buildBmView() : null,
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
      result: this.phase === "result" || this.phase === "blackmarket" || this.phase === "bandit" ? this.lastResult : null,
      hazard: this.phase === "hazard" ? { type: "creature", severity: this.hazardSeverity } : null,
      anomaly: this.phase === "anomaly" && l?.anomalyEffect ? { text: l.anomalyEffect } : null,
      bandit: this.phase === "bandit" ? { severity: this.banditSeverity, pocket: Math.round(this.pocket) } : null,
      gameover: this.phase === "gameover" ? this.gameoverInfo : null,
      surfaced: this.phase === "surfaced" ? this.surfacedInfo : null,
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
    const t = this.time;
    const sway = this.phase === "observe" ? 0 : Math.sin(t * 0.06) * 12;
    const stage = this.layer ? stageForDepth(this.depth) : "shallow";

    // 左壁（有机曲线）
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w * 0.2 + sway, 0);
    ctx.quadraticCurveTo(w * 0.09 + sway, h * 0.3, w * 0.16 + sway * 1.2, h * 0.52);
    ctx.quadraticCurveTo(w * 0.21 + sway * 0.8, h * 0.76, w * 0.12 + sway, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    // 右壁
    ctx.beginPath();
    ctx.moveTo(w, 0);
    ctx.lineTo(w * 0.8 - sway, 0);
    ctx.quadraticCurveTo(w * 0.91 - sway, h * 0.3, w * 0.84 - sway * 1.2, h * 0.52);
    ctx.quadraticCurveTo(w * 0.79 - sway * 0.8, h * 0.76, w * 0.88 - sway, h);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // 壁面向洞穴中心渐暗，制造纵深
    const shadeL = ctx.createLinearGradient(0, 0, w * 0.26, 0);
    shadeL.addColorStop(0, "rgba(0,0,0,0.55)");
    shadeL.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shadeL;
    ctx.fillRect(0, 0, w * 0.26, h);
    const shadeR = ctx.createLinearGradient(w * 0.74, 0, w, 0);
    shadeR.addColorStop(0, "rgba(0,0,0,0)");
    shadeR.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = shadeR;
    ctx.fillRect(w * 0.74, 0, w * 0.26, h);

    // 阶段氛围细节（确定性位置，避免闪烁）
    if (stage === "oldmine") {
      ctx.strokeStyle = "rgba(130,95,55,0.5)";
      ctx.lineWidth = 5;
      for (let i = 0; i < 3; i++) {
        const yy = h * (0.22 + i * 0.24);
        ctx.beginPath();
        ctx.moveTo(-6, yy);
        ctx.lineTo(w * 0.18 + sway, yy);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(w + 6, yy);
        ctx.lineTo(w * 0.82 - sway, yy);
        ctx.stroke();
      }
    } else if (stage === "bio") {
      const rnd = mulberry32((this.layer ? this.layer.index : 0) * 31 + 5);
      ctx.strokeStyle = "rgba(95,201,143,0.2)";
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 12; i++) {
        const side = rnd() < 0.5 ? -1 : 1;
        const x0 = side < 0 ? 0 : w;
        const y0 = h * (0.15 + rnd() * 0.7);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        let px = x0, py = y0;
        const segs = 2 + Math.floor(rnd() * 3);
        for (let s = 0; s < segs; s++) {
          px += side * w * (0.04 + rnd() * 0.05);
          py += (rnd() - 0.4) * 40;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    } else if (stage === "magma") {
      const pulse = 0.22 + 0.12 * Math.sin(t * 2);
      const rnd = mulberry32((this.layer ? this.layer.index : 0) * 17 + 3);
      ctx.strokeStyle = `rgba(255,90,30,${pulse})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const side = rnd() < 0.5 ? -1 : 1;
        const x0 = side < 0 ? w * 0.06 : w * 0.94;
        const y0 = h * (0.12 + rnd() * 0.8);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + side * w * 0.06, y0 + (rnd() - 0.5) * 30);
        ctx.stroke();
      }
    }
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
      ctx.lineTo(x, top + 3 + Math.sin(x * 0.035 + (this.phase === "observe" ? 0 : this.time * 0.5)) * 3);
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
      : Math.sin(this.time * 1.6) * 1.3;
    const face = this.rockFaceY();
    const push = active ? this.wallHole * 16 : 0;
    const bodyBottom = face - 54 + push;
    const bodyTop = bodyBottom - 56;

    ctx.save();
    ctx.translate(cx + Math.sin(this.time * 1.8) * 2, 0);

    // —— 顶部锚固（井口框架 + 滑轮）——
    ctx.fillStyle = "#33271a";
    ctx.fillRect(-52, 0, 104, 10);
    ctx.fillStyle = "#4a3a24";
    ctx.fillRect(-46, 10, 92, 12);
    ctx.fillStyle = "#6b5638";
    ctx.fillRect(-4, 0, 8, 22);
    ctx.fillStyle = "#7d6a4e";
    ctx.beginPath();
    ctx.arc(0, 8, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(233,187,110,0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // —— 缆绳（轻微摆动 + 麻花纹理）——
    const sway = Math.sin(this.time * 1.2) * 3;
    ctx.strokeStyle = "#5a4a30";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.quadraticCurveTo(sway, (bodyTop + 6) / 2, sway * 0.4, bodyTop + 6);
    ctx.stroke();
    ctx.strokeStyle = "rgba(233,187,110,0.18)";
    ctx.lineWidth = 1;
    for (let y = 24; y < bodyTop + 4; y += 7) {
      ctx.beginPath();
      ctx.moveTo(-2 + Math.sin(y * 0.4) * 2, y);
      ctx.lineTo(2 + Math.sin(y * 0.4 + 1) * 2, y);
      ctx.stroke();
    }

    // —— 机身 ——
    ctx.save();
    ctx.rotate(jitter * 0.012);

    const bodyGrad = ctx.createLinearGradient(-40, bodyTop, 40, bodyBottom);
    bodyGrad.addColorStop(0, "#5c4a33");
    bodyGrad.addColorStop(0.45, "#8a7454");
    bodyGrad.addColorStop(1, "#3a2e1c");
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.roundRect(-36, bodyTop, 72, 56, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(233,187,110,0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();
    // 顶部高光
    ctx.fillStyle = "rgba(255,240,210,0.12)";
    ctx.beginPath();
    ctx.roundRect(-36, bodyTop, 72, 14, [10, 10, 4, 4]);
    ctx.fill();
    // 铆钉
    ctx.fillStyle = "rgba(255,240,210,0.55)";
    for (const [rx, ry] of [[-28, bodyTop + 8], [28, bodyTop + 8], [-28, bodyBottom - 12], [28, bodyBottom - 12]]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // 警示斜纹
    ctx.save();
    ctx.beginPath();
    ctx.rect(-36, bodyTop + 19, 72, 8);
    ctx.clip();
    ctx.fillStyle = "rgba(20,14,8,0.5)";
    for (let x = -40; x < 44; x += 12) {
      ctx.beginPath();
      ctx.moveTo(x, bodyTop + 19);
      ctx.lineTo(x + 7, bodyTop + 19);
      ctx.lineTo(x - 3, bodyTop + 27);
      ctx.lineTo(x - 10, bodyTop + 27);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 中央舷窗（琥珀灯光）
    const winY = bodyTop + 33;
    const winGrad = ctx.createRadialGradient(0, winY, 1, 0, winY, 14);
    winGrad.addColorStop(0, "rgba(255,214,120,0.95)");
    winGrad.addColorStop(1, "rgba(120,84,30,0.9)");
    ctx.fillStyle = winGrad;
    ctx.beginPath();
    ctx.roundRect(-13, winY - 6, 26, 12, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(40,28,16,0.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // —— 底部探照灯（径向光晕 + 锥形光柱照向岩层）——
    const lightY = bodyBottom - 4;
    const lightGrad = ctx.createRadialGradient(0, lightY, 2, 0, lightY, 40);
    lightGrad.addColorStop(0, active ? "rgba(255,200,87,0.55)" : "rgba(255,200,87,0.3)");
    lightGrad.addColorStop(1, "rgba(255,200,87,0)");
    ctx.fillStyle = lightGrad;
    ctx.beginPath();
    ctx.arc(0, lightY, 40, 0, Math.PI * 2);
    ctx.fill();

    const coneLen = Math.min(h - lightY, face + 150 - lightY);
    if (coneLen > 10) {
      const coneGrad = ctx.createLinearGradient(0, lightY, 0, lightY + coneLen);
      coneGrad.addColorStop(0, active ? "rgba(255,210,130,0.20)" : "rgba(255,210,130,0.12)");
      coneGrad.addColorStop(1, "rgba(255,210,130,0)");
      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.moveTo(-8, lightY);
      ctx.lineTo(-34, lightY + coneLen);
      ctx.lineTo(34, lightY + coneLen);
      ctx.lineTo(8, lightY);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = active ? "#ffd166" : "#c99a4a";
    ctx.shadowColor = "#ffc857";
    ctx.shadowBlur = active ? 20 : 10;
    ctx.beginPath();
    ctx.arc(0, lightY, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // —— 钻头连接件 ——
    ctx.fillStyle = "#3a2e1c";
    ctx.strokeStyle = "rgba(233,187,110,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-15, bodyBottom - 2, 30, 26, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#6b5638";
    ctx.beginPath();
    ctx.roundRect(-17, bodyBottom + 18, 34, 8, 3);
    ctx.fill();

    // —— 旋转钻头 ——
    const bitTop = bodyBottom + 26;
    const bitLen = 34;
    ctx.save();
    ctx.translate(0, bitTop);
    ctx.rotate(active ? this.time * 42 : this.time * 5);
    const bitGrad = ctx.createLinearGradient(-12, 0, 12, bitLen);
    bitGrad.addColorStop(0, "#d9cba6");
    bitGrad.addColorStop(0.5, "#a89a7e");
    bitGrad.addColorStop(1, "#6e6450");
    ctx.fillStyle = bitGrad;
    ctx.beginPath();
    ctx.moveTo(-11, 0);
    ctx.lineTo(0, bitLen);
    ctx.lineTo(11, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(60,48,30,0.8)";
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(0, i * 7.5, 8 - i * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.moveTo(-3, 2);
    ctx.lineTo(0, 10);
    ctx.lineTo(3, 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore(); // 机身
    ctx.restore(); // 整体
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

    // —— 左上：深度卡片 ——
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "rgba(22,16,10,0.72)";
    ctx.beginPath();
    ctx.roundRect(pad - 10, pad - 6, 122, 54, 12);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(233,187,110,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(pad - 10, pad - 6, 122, 54, 12);
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.font = "bold 26px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = "#f6ead4";
    ctx.fillText(`${Math.round(this.depthDisplay)}m`, pad, pad + 26);
    ctx.font = "12px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = "rgba(240,218,178,0.7)";
    ctx.fillText(this.stageName(), pad, pad + 44);

    // —— 右上：Combo / 本轮收益卡片 ——
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "rgba(22,16,10,0.72)";
    ctx.beginPath();
    ctx.roundRect(w - pad - 158, pad - 6, 158, 54, 12);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(233,187,110,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(w - pad - 158, pad - 6, 158, 54, 12);
    ctx.stroke();

    ctx.textAlign = "right";
    ctx.font = "bold 20px 'Microsoft YaHei', sans-serif";
    ctx.shadowColor = "#ffd166";
    ctx.shadowBlur = 12;
    ctx.fillStyle = this.combo >= 3 ? "#ffd166" : "#ffffff";
    ctx.fillText(`Combo ${fmtCombo(this.combo)}`, w - pad, pad + 24);
    ctx.shadowBlur = 0;
    ctx.font = "bold 14px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = "#5fc98f";
    ctx.fillText(`本轮 ${fmt(this.loadValue)}`, w - pad, pad + 43);
    ctx.textAlign = "left";

    // —— 左：状态条（耐久 / 电量 / 岩浆带过热）——
    const barX = pad;
    const barW = 14;
    const y0 = 88;
    const barGap = 20;
    const barH = Math.min(200, h * 0.24);
    this.drawBar(ctx, barX, y0, barH, barW, this.durability / this.maxDurability, "#e08a45", "耐久");
    this.drawBar(ctx, barX, y0 + barH + barGap, barH, barW, this.power / this.maxPower, "#ffd166", "电量");
    if (this.layer?.stage === "magma") {
      this.drawBar(ctx, barX, y0 + 2 * (barH + barGap), barH, barW, this.overheat / 100, this.overheat > 75 ? "#ff5522" : "#ff8c42", "过热");
    }

    // —— 右：负重条 ——
    const rx = w - pad - barW;
    const ratio = this.slotRatio();
    const loadColor = ratio > 1.15 ? "#ff5a3c" : ratio > 1 ? "#e0665a" : ratio > 0.8 ? "#f0a23c" : ratio > 0.6 ? "#ffc857" : "#5fc98f";
    this.drawBar(ctx, rx, y0, barH + 60, barW, Math.min(1.4, ratio) / 1.4, loadColor, `背包 ${this.usedSlots()}/${this.slots}`);

    // —— 底部事件日志（观察阶段抬高，避免被底部面板遮挡）——
    const logY = this.phase === "observe" ? h - 182 : h - 14;
    ctx.textAlign = "center";
    ctx.font = "13px 'Microsoft YaHei', sans-serif";
    this.log.slice(-2).forEach((entry, i) => {
      ctx.globalAlpha = 0.6 + 0.4 * (i / 2);
      ctx.fillStyle = entry.kind === "good" ? "#5fc98f" : entry.kind === "bad" ? "#ff8a80" : entry.kind === "warn" ? "#ffc857" : "#e8dcc6";
      ctx.fillText(entry.text, w / 2, logY - (1 - i) * 18);
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

