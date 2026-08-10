import {
  CHECKPOINTS, ORES, backpackStats, detectionStats, drillStats,
  evacCost, isEvacDepth, isSpecialEvacDepth,
  fmt, fmtCombo, persistSave, safetyStats, stageForDepth, supportStats,
} from "./config";
import type { OreId, OreStack, SaveData } from "./config";
import {
  Layer, VEIN_NAME, collapseRiskLabel as wcRiskLabel, generateLayer, hazardName, overloadOrePool, rollOreYield, upgradeQuality,
} from "./world";
import { ARCHETYPES, CHALLENGE_DEFS, ROOMS, ROOM_ORDER, MODULE_POOL, ORDERS, ensureDailyOrders, pickModules } from "./content";
import type { TraitId } from "./content";
import {
  CONSUMABLES, DIFFICULTY_DEFS, EMPTY_EQUIP_STATS, EQUIPMENT_DEFS,
  ORE_QUALITIES, blackBuyDiscount, blackMarketRepairCost, blackSellRatio,
  computeRating, dailyTasks, dateKey, generateBmStock, makeEquipmentInstance,
  mergeEquipStats, oreStackKey, oreUnitValue as oreUnitValueBase,
} from "./items";
import type {
  BmStockItem, BuffId, Difficulty, EquipmentInstance, EquipmentStats, OreQuality,
} from "./items";
import type {
  ArchetypeId, BagSlot, BlackMarketView, BossView, ChallengeId, DailyTaskView, DisasterMode,
  EngineCallbacks, EvacInfo, ForwardBaseView, LogEntry, ModuleChoice, ModuleId, RevealLevel,
  RiskRange, RoomId, RoomView, RouteChoice, RunConfig, RunPhase, RunResult, RunStateSnapshot, UiSnapshot,
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

// 字符串种子 -> 数字（FNV-1a），用于本局可复现随机
export function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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
  private config: RunConfig = { difficulty: "normal", pocket: 0, buffs: [], equipment: [], items: [], archetype: null, seed: "", challenge: [], disasterMode: "gauge" };
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
  private disasterGuardLayers = 0; // v5：应急锚点剩余保护层数（50m = 5 层）
  private disasterMode: DisasterMode = "gauge";   // v6：灾难模式（累计值 / 随机概率）
  private disasterGauge = 0;                       // v6：灾难累计值 0..100
  private gaugeGainMult = 1;                       // v6：累计值增速修正（增益/道具）
  private evacAvailable = false;                   // v6：当前深度是否为撤离点
  private evacSpecial = false;                     // v6：是否特殊撤离点
  private evacCost = 0;                            // v6：特殊撤离所需现金
  private evacSuppliedDepth = -1;                  // v6：已触发补给的撤离点深度
  private pierceBuff = 0;
  private qualityBonus = 0;
  private valueBonus = 0;
  private wearReduce = 0;
  private banditReduce = 0;
  private canBlackMarket = false;
  private bmStock: BmStockItem[] = [];
  private bmGenerated = false;  // 本局黑市货架是否已生成（首次生成后固定，可付费刷新）
  private bmEncounterDepth = -1; // v6.1：当前货架对应的黑市深度（新黑市自动上新）
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
  // 局内购入的装备：只有成功撤离才写入仓库
  private runPendingEquipment: EquipmentInstance[] = [];
  // ================= v4 状态 =================
  private archetype: ArchetypeId | null = null;
  private challenge: ChallengeId[] = [];
  private modules: ModuleId[] = [];
  private traits: TraitId[] = [];
  private seed = "";
  private rnd: () => number = Math.random;   // 本局随机源（种子可复现）
  private rndCount = 0;                        // v9：主 RNG 已消耗次数（断局续玩）
  private recoveredRun = false;                  // v9：本局是否为断局续玩恢复（恢复局不上榜）
  private revealLevel: RevealLevel = "none";
  private cautiousCooldown = 0;              // 稳妥模式冷却剩余层数
  private standardStopped = false;           // 本层标准模式是否已收手
  private drillHeat = 0;                     // 超载钻进热量
  private creatureImmune = 0;                // 接下来 N 层无生物（巢穴诱饵）
  private heatGainMult = 1;                  // 热量增长倍率
  private riskReduce = 0;                    // 全局风险削减（加固井壁等，0..0.5）
  private qualityBoostRun = 0;               // 本局高品质概率额外加成 %
  private stackCap = 99;                     // 矿石堆叠上限（压缩货舱 999）
  private overloadGainBonus = 0;             // 超载收益额外 %
  private overloadRiskMult = 1;              // 超载风险倍率
  private pierceCapBonus = 0;                // 穿透上限额外层数
  private baitAvoid = 0;                     // 生物自动驱散概率 %
  private autoCompress = false;              // 满格自动压缩最低价值矿堆
  private revealQualityAuto = false;         // 每层自动揭示矿脉品质
  private gasConvert = false;                // 毒气转为电量
  private shieldModuleUsed = false;          // 护盾发生器是否已消耗
  private routeBuff: { qualityShift: number; riskShift: number; layersLeft: number; roomBoost?: number } | null = null;
  private visitedRooms: string[] = [];
  private baseBuilt: Record<number, boolean> = {};
  private bossState: { id: string; name: string; hp: number; maxHp: number } | null = null;
  private overloadUsedThisRun = 0;
  private anomalySeenThisRun = 0;
  private evacGuaranteed = false;            // 深渊生存者：消耗 combo 保证撤离
  private creditUsed = false;                // 拾荒商人：赊账一次
  private moduleMilestoneDone: number[] = [];
  private bmDiscountRun = 0;                 // 本局黑市折扣累计（营地“黑市渠道”）
  private previewLayer: Layer | null = null; // v7：已预生成的下一层（预览与实际消费同一对象，保证种子复现）
  private nextSlotId = 1;                    // v7：背包格子唯一 ID 生成器
  private drillUiAccum = 0;                  // v7：钻进中节流推送 HUD 快照
  private pageHidden = false;                 // v10: page hidden -> auto pause
  // v4 事件视图（route/room/module/base 阶段由 buildSnapshot 读取）
  private roomView: RoomView | null = null;
  private routeOptions: RouteChoice[] | null = null;
  private moduleOptions: ModuleChoice[] | null = null;
  private baseView: ForwardBaseView | null = null;
  // 流派/特性派生的小状态
  private pocketDim = false;        // 特殊物品不占格
  private luckyPick = 0;            // 品质提升额外 %
  private doubleDip = false;        // 每层额外 1 矿
  private ghostBit = false;         // 穿透不消耗额外电量
  private scrapArmor = false;       // 耐久越低收益越高
  private staticCoil = false;       // 岩浆层电量减半
  private moltenHeart = false;      // 超载收益 +15%
  private overclockChip = false;    // 超载临界范围爆破不损伤
  private echoLens = false;         // 探测器可预览路线
  private detectorBonusRun = 0;     // 流派探测器加成
  private accuracyBonusRun = 0;     // 流派精度加成
  private slotBonusRun = 0;         // 流派背包格加成
  private anomalyResistRun = 0;     // 流派异常抗性加成
  private gameoverInfo: UiSnapshot["gameover"] | null = null;
  private surfacedInfo: UiSnapshot["surfaced"] | null = null;
  private log: LogEntry[] = [];
  private particles: Particle[] = [];
  private floatTexts: FloatText[] = [];
  private shake = 0;
  private flash = 0;
  private reduceMotion = false;   // v10: settings shake toggle
  private shakeEnabled = true; // v8：设置-减少动态（减弱震屏/闪光/粒子）
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
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVis);
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVis);
    this.audio.stopDrill();
  }

  private onVis = (): void => {
    this.pageHidden = typeof document !== "undefined" && document.hidden;
  };

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
    // v4：流派 / 挑战 / 种子
    this.archetype = config.archetype ?? null;
    this.challenge = [...config.challenge];
    this.seed = config.seed || "";
    this.rndCount = 0;
    const rawRnd = this.seed ? mulberry32(hashSeed(this.seed)) : null;
    this.rnd = rawRnd ? () => { this.rndCount++; return rawRnd(); } : Math.random;
    this.modules = [];
    this.traits = [];
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
    this.disasterGuardLayers = 0;
    this.nextTransparent = false;
    this.runEnded = false;
    this.recoveredRun = false;
    this.reduceMotion = !!save.settings?.reduceMotion;
    this.shakeEnabled = save.settings?.shakeEnabled !== false;
    this.minedThisRun = 0;
    this.scaredThisRun = 0;
    this.canBlackMarket = false;
    this.bmStock = [];
    this.bmGenerated = false;
    this.bmEncounterDepth = -1;
    this.bag = [];
    this.loadValue = 0;
    this.lastResult = null;
    this.resultOres = [];
    this.runPendingEquipment = [];
    this.gameoverInfo = null;
    this.surfacedInfo = null;
    this.particles = [];
    this.floatTexts = [];
    this.log = [];

    // v4 状态重置
    this.revealLevel = "none";
    this.cautiousCooldown = 0;
    this.standardStopped = false;
    this.drillHeat = 0;
    this.creatureImmune = 0;
    this.heatGainMult = 1;
    this.riskReduce = 0;
    this.qualityBoostRun = 0;
    // v9：图鉴研究 —— 总研究等级提升堆叠上限（最高 +40）
    this.stackCap = 99 + Math.min(40, this.totalResearchLevels());
    this.overloadGainBonus = 0;
    this.overloadRiskMult = 1;
    this.pierceCapBonus = 0;
    this.baitAvoid = 0;
    this.autoCompress = false;
    this.revealQualityAuto = false;
    this.gasConvert = false;
    this.shieldModuleUsed = false;
    this.routeBuff = null;
    this.visitedRooms = [];
    this.baseBuilt = {};
    this.bossState = null;
    this.overloadUsedThisRun = 0;
    this.anomalySeenThisRun = 0;
    this.evacGuaranteed = false;
    this.creditUsed = false;
    this.moduleMilestoneDone = [];
    this.bmDiscountRun = 0;
    this.disasterMode = config.disasterMode ?? "gauge";
    this.disasterGauge = 0;
    this.gaugeGainMult = this.hasBuff("gauge_less") ? 0.6 : 1;
    this.evacAvailable = false;
    this.evacSpecial = false;
    this.evacCost = 0;
    this.evacSuppliedDepth = -1;

    // v7：挑战「轻装出发」——最多携带 2 件装备（奖励倍率只按实际生效的词缀结算）
    const equipList = this.challenge.includes("limited_gear") ? config.equipment.slice(0, 2) : config.equipment;
    if (config.equipment.length > equipList.length) {
      this.logAdd("挑战「轻装出发」生效：只能携带 2 件装备", "warn");
    }
    // 装备加成汇总（实例自带 tier 缩放属性）
    this.equipStats = mergeEquipStats(...equipList.map((e) => e.stats));
    // v4：装备规则特性
    this.traits = equipList.map((e) => EQUIPMENT_DEFS[e.id]?.trait).filter((t): t is TraitId => !!t);
    this.qualityBonus = (this.hasBuff("quality") ? 15 : 0) + this.equipStats.qualityBonus;
    this.valueBonus = this.equipStats.valueBonus;
    // v7：减免钳制在 90% 以内，避免极品装备（tier3×3.2）叠加超过 100% 导致公式反向
    this.wearReduce = Math.min(90, (this.hasBuff("wear_less") ? 30 : 0) + this.equipStats.wearReduce);
    this.pierceBuff = (this.hasBuff("pierce") ? 5 : 0) + this.equipStats.pierceBonus;
    this.banditReduce = Math.min(90, this.equipStats.banditReduce);
    this.gasImmune = this.hasBuff("gas");
    this.shieldActive = this.hasBuff("shield");
    // v4：特性派生
    if (this.traits.includes("ice_core")) this.heatGainMult *= 0.7;
    if (this.traits.includes("vent_cool")) this.overloadRiskMult *= 0.7;
    if (this.traits.includes("rich_blood")) this.riskReduce += 0.5;
    if (this.traits.includes("magnet")) this.autoCompress = true;
    if (this.traits.includes("deep_sight")) this.revealQualityAuto = true;
    if (this.traits.includes("gas_convert")) this.gasConvert = true;
    if (this.traits.includes("lure_pouch")) this.baitAvoid = Math.max(this.baitAvoid, 40);
    if (this.traits.includes("pocket_dim")) this.pocketDim = true;
    if (this.traits.includes("lucky_pick")) this.luckyPick = 5;
    if (this.traits.includes("double_dip")) this.doubleDip = true;
    if (this.traits.includes("ghost_bit")) this.ghostBit = true;
    if (this.traits.includes("scrap_armor")) this.scrapArmor = true;
    if (this.traits.includes("static_coil")) this.staticCoil = true;
    if (this.traits.includes("molten_heart")) this.moltenHeart = true;
    if (this.traits.includes("overclock_chip")) this.overclockChip = true;
    if (this.traits.includes("echo_lens")) this.echoLens = true;
    // v4：流派初始加成
    const arch = this.archetype ? ARCHETYPES[this.archetype] : null;
    if (arch) {
      if (this.archetype === "hunter") {
        this.qualityBonus += 10;
        this.detectorBonusRun = 1;
        this.accuracyBonusRun = 20;
      } else if (this.archetype === "overdriver") {
        this.overloadGainBonus += 20;
      } else if (this.archetype === "scavenger") {
        this.slotBonusRun = 2;
      } else if (this.archetype === "survivor") {
        this.anomalyResistRun = 25;
      }
      this.logAdd(`流派「${arch.name}」生效`, "good");
    }
    if (this.challenge.includes("no_blackmarket")) this.logAdd("挑战：本局禁黑市", "warn");

    const ds = drillStats(save.upgrades.drill);
    this.maxDurability = ds.maxDurability;
    this.durability = ds.maxDurability;
    this.maxPower = this.hasBuff("fuel") ? 175 : 135;
    this.power = this.maxPower;

    const bs = backpackStats(save.upgrades.backpack);
    this.slots = bs.slots + this.equipStats.slotBonus + (this.hasBuff("slots") ? 2 : 0) + this.slotBonusRun;
    if (this.pocketDim) this.slots += 1; // v7：折叠空间 背包格 +1
    const ss = supportStats(save.upgrades.support);
    this.supports = ss.supports;
    const det = detectionStats(save.upgrades.detection);
    this.detectors = det.detectors + this.equipStats.detectorBonus + this.detectorBonusRun;

    // 携带的消耗品入包（格子不够则散落损失）
    for (const itemId of config.items) {
      const def = CONSUMABLES[itemId];
      if (!def || def.kind !== "consumable") continue;
      if (this.usedSlots() >= this.slots) {
        this.logAdd(`背包已满，${def.name} 散落损失`, "warn");
        continue;
      }
      this.bag.push({
        slotId: this.newSlotId(), key: "item:" + itemId, kind: "item", id: itemId, count: 1,
        name: def.name, color: def.color, icon: def.icon, value: 0, unitValue: 0,
      });
    }

    this.layer = this.genLayer(startDepth, this.currentAccuracy());
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

  // ================= v9：断局续玩 =================
  captureRunState(): RunStateSnapshot {
    return {
      version: 1,
      save: this.save,
      config: { ...this.config },
      rngCount: this.rndCount,
      phase: this.phase,
      depth: this.depth,
      layer: this.layer,
      previewLayer: this.previewLayer,
      power: this.power, maxPower: this.maxPower,
      durability: this.durability, maxDurability: this.maxDurability,
      overheat: this.overheat,
      combo: this.combo,
      supports: this.supports,
      detectors: this.detectors,
      slots: this.slots,
      bag: this.bag.map((s) => ({ ...s })),
      loadValue: this.loadValue,
      pocket: this.pocket,
      difficulty: this.difficulty,
      buffs: [...this.buffs],
      gasImmune: this.gasImmune,
      shieldActive: this.shieldActive,
      disasterGuardLayers: this.disasterGuardLayers,
      disasterMode: this.disasterMode,
      disasterGauge: this.disasterGauge,
      gaugeGainMult: this.gaugeGainMult,
      evacAvailable: this.evacAvailable,
      evacSpecial: this.evacSpecial,
      evacCost: this.evacCost,
      evacSuppliedDepth: this.evacSuppliedDepth,
      pierceBuff: this.pierceBuff,
      qualityBonus: this.qualityBonus,
      valueBonus: this.valueBonus,
      wearReduce: this.wearReduce,
      banditReduce: this.banditReduce,
      canBlackMarket: this.canBlackMarket,
      bmStock: this.bmStock.map((s) => ({ ...s })),
      bmGenerated: this.bmGenerated,
      bmEncounterDepth: this.bmEncounterDepth,
      milkCount: this.milkCount,
      supportsUsedThisLayer: this.supportsUsedThisLayer,
      retreatBlocked: this.retreatBlocked,
      anomalyDouble: this.anomalyDouble,
      anomalyDoubleLoss: this.anomalyDoubleLoss,
      detectorDisabled: this.detectorDisabled,
      megaShieldUsed: this.megaShieldUsed,
      nextTransparent: this.nextTransparent,
      banditSeverity: this.banditSeverity,
      runEnded: this.runEnded,
      minedThisRun: this.minedThisRun,
      scaredThisRun: this.scaredThisRun,
      lastResult: this.lastResult,
      resultOres: this.resultOres.map((s) => ({ ...s })),
      runPendingEquipment: this.runPendingEquipment.map((e) => ({ ...e, stats: { ...e.stats } })),
      archetype: this.archetype,
      challenge: [...this.challenge],
      modules: [...this.modules],
      traits: [...this.traits],
      seed: this.seed,
      revealLevel: this.revealLevel,
      cautiousCooldown: this.cautiousCooldown,
      standardStopped: this.standardStopped,
      drillHeat: this.drillHeat,
      creatureImmune: this.creatureImmune,
      heatGainMult: this.heatGainMult,
      riskReduce: this.riskReduce,
      qualityBoostRun: this.qualityBoostRun,
      stackCap: this.stackCap,
      overloadGainBonus: this.overloadGainBonus,
      overloadRiskMult: this.overloadRiskMult,
      pierceCapBonus: this.pierceCapBonus,
      baitAvoid: this.baitAvoid,
      autoCompress: this.autoCompress,
      revealQualityAuto: this.revealQualityAuto,
      gasConvert: this.gasConvert,
      shieldModuleUsed: this.shieldModuleUsed,
      routeBuff: this.routeBuff ? { ...this.routeBuff } : null,
      visitedRooms: [...this.visitedRooms],
      baseBuilt: { ...this.baseBuilt },
      bossState: this.bossState ? { ...this.bossState } : null,
      overloadUsedThisRun: this.overloadUsedThisRun,
      anomalySeenThisRun: this.anomalySeenThisRun,
      evacGuaranteed: this.evacGuaranteed,
      creditUsed: this.creditUsed,
      moduleMilestoneDone: [...this.moduleMilestoneDone],
      bmDiscountRun: this.bmDiscountRun,
      nextSlotId: this.nextSlotId,
      roomView: this.roomView ? { ...this.roomView, options: this.roomView.options.map((o) => ({ ...o })) } : null,
      routeOptions: this.routeOptions?.map((r) => ({ ...r })) ?? null,
      moduleOptions: this.moduleOptions?.map((m) => ({ ...m })) ?? null,
      baseView: this.baseView ? { ...this.baseView, needOre: this.baseView.needOre ? { ...this.baseView.needOre } : null, options: this.baseView.options.map((o) => ({ ...o })) } : null,
      pocketDim: this.pocketDim,
      luckyPick: this.luckyPick,
      doubleDip: this.doubleDip,
      ghostBit: this.ghostBit,
      scrapArmor: this.scrapArmor,
      staticCoil: this.staticCoil,
      moltenHeart: this.moltenHeart,
      overclockChip: this.overclockChip,
      echoLens: this.echoLens,
      detectorBonusRun: this.detectorBonusRun,
      accuracyBonusRun: this.accuracyBonusRun,
      slotBonusRun: this.slotBonusRun,
      anomalyResistRun: this.anomalyResistRun,
      gameoverInfo: this.gameoverInfo,
      surfacedInfo: this.surfacedInfo,
      log: this.log.map((l) => ({ ...l })),
      equipStats: { ...this.equipStats },
    };
  }

  restoreRunState(snap: RunStateSnapshot): void {
    // 逻辑状态恢复（覆盖 startRun 的初始状态）
    this.save = snap.save;
    this.config = { ...snap.config };
    this.difficulty = snap.difficulty;
    this.recoveredRun = true; // v9：恢复局标记（不上榜）
    this.pocket = snap.pocket;
    this.buffs = [...snap.buffs];
    this.archetype = snap.archetype;
    this.challenge = [...snap.challenge];
    this.seed = snap.seed;
    // 重建 RNG：同一种子 + 已消耗次数 -> 后续完全确定（断局续玩不改变世界）
    this.rndCount = snap.rngCount;
    const rawRnd = this.seed ? mulberry32(hashSeed(this.seed)) : null;
    if (rawRnd) {
      for (let i = 0; i < this.rndCount; i++) rawRnd();
      this.rnd = () => { this.rndCount++; return rawRnd(); };
    } else {
      this.rnd = Math.random;
    }
    this.modules = [...snap.modules];
    this.traits = [...snap.traits] as TraitId[];
    this.depth = snap.depth;
    this.depthDisplay = snap.depth;
    this.phase = snap.phase;
    this.layer = snap.layer;
    this.previewLayer = snap.previewLayer;
    this.power = snap.power; this.maxPower = snap.maxPower;
    this.durability = snap.durability; this.maxDurability = snap.maxDurability;
    this.overheat = snap.overheat;
    this.combo = snap.combo;
    this.supports = snap.supports;
    this.detectors = snap.detectors;
    this.slots = snap.slots;
    this.bag = snap.bag.map((s) => ({ ...s }));
    this.loadValue = snap.loadValue;
    this.gasImmune = snap.gasImmune;
    this.shieldActive = snap.shieldActive;
    this.disasterGuardLayers = snap.disasterGuardLayers;
    this.disasterMode = snap.disasterMode;
    this.disasterGauge = snap.disasterGauge;
    this.gaugeGainMult = snap.gaugeGainMult;
    this.evacAvailable = snap.evacAvailable;
    this.evacSpecial = snap.evacSpecial;
    this.evacCost = snap.evacCost;
    this.evacSuppliedDepth = snap.evacSuppliedDepth;
    this.pierceBuff = snap.pierceBuff;
    this.qualityBonus = snap.qualityBonus;
    this.valueBonus = snap.valueBonus;
    this.wearReduce = snap.wearReduce;
    this.banditReduce = snap.banditReduce;
    this.canBlackMarket = snap.canBlackMarket;
    this.bmStock = snap.bmStock.map((s) => ({ ...s }));
    this.bmGenerated = snap.bmGenerated;
    this.bmEncounterDepth = snap.bmEncounterDepth;
    this.milkCount = snap.milkCount;
    this.supportsUsedThisLayer = snap.supportsUsedThisLayer;
    this.retreatBlocked = snap.retreatBlocked;
    this.anomalyDouble = snap.anomalyDouble;
    this.anomalyDoubleLoss = snap.anomalyDoubleLoss;
    this.detectorDisabled = snap.detectorDisabled;
    this.megaShieldUsed = snap.megaShieldUsed;
    this.nextTransparent = snap.nextTransparent;
    this.banditSeverity = snap.banditSeverity;
    this.runEnded = snap.runEnded;
    this.minedThisRun = snap.minedThisRun;
    this.scaredThisRun = snap.scaredThisRun;
    this.lastResult = snap.lastResult;
    this.resultOres = snap.resultOres.map((s) => ({ ...s }));
    this.runPendingEquipment = snap.runPendingEquipment.map((e) => ({ ...e, stats: { ...e.stats } }));
    this.revealLevel = snap.revealLevel;
    this.cautiousCooldown = snap.cautiousCooldown;
    this.standardStopped = snap.standardStopped;
    this.drillHeat = snap.drillHeat;
    this.creatureImmune = snap.creatureImmune;
    this.heatGainMult = snap.heatGainMult;
    this.riskReduce = snap.riskReduce;
    this.qualityBoostRun = snap.qualityBoostRun;
    this.stackCap = snap.stackCap;
    this.overloadGainBonus = snap.overloadGainBonus;
    this.overloadRiskMult = snap.overloadRiskMult;
    this.pierceCapBonus = snap.pierceCapBonus;
    this.baitAvoid = snap.baitAvoid;
    this.autoCompress = snap.autoCompress;
    this.revealQualityAuto = snap.revealQualityAuto;
    this.gasConvert = snap.gasConvert;
    this.shieldModuleUsed = snap.shieldModuleUsed;
    this.routeBuff = snap.routeBuff ? { ...snap.routeBuff } : null;
    this.visitedRooms = [...snap.visitedRooms];
    this.baseBuilt = { ...snap.baseBuilt };
    this.bossState = snap.bossState ? { ...snap.bossState } : null;
    this.overloadUsedThisRun = snap.overloadUsedThisRun;
    this.anomalySeenThisRun = snap.anomalySeenThisRun;
    this.evacGuaranteed = snap.evacGuaranteed;
    this.creditUsed = snap.creditUsed;
    this.moduleMilestoneDone = [...snap.moduleMilestoneDone];
    this.bmDiscountRun = snap.bmDiscountRun;
    this.nextSlotId = snap.nextSlotId;
    this.roomView = snap.roomView ? { ...snap.roomView, options: snap.roomView.options.map((o) => ({ ...o })) } : null;
    this.routeOptions = snap.routeOptions?.map((r) => ({ ...r })) ?? null;
    this.moduleOptions = snap.moduleOptions?.map((m) => ({ ...m })) ?? null;
    this.baseView = snap.baseView ? { ...snap.baseView, needOre: snap.baseView.needOre ? { ...snap.baseView.needOre } : null, options: snap.baseView.options.map((o) => ({ ...o })) } : null;
    this.pocketDim = snap.pocketDim;
    this.luckyPick = snap.luckyPick;
    this.doubleDip = snap.doubleDip;
    this.ghostBit = snap.ghostBit;
    this.scrapArmor = snap.scrapArmor;
    this.staticCoil = snap.staticCoil;
    this.moltenHeart = snap.moltenHeart;
    this.overclockChip = snap.overclockChip;
    this.echoLens = snap.echoLens;
    this.detectorBonusRun = snap.detectorBonusRun;
    this.accuracyBonusRun = snap.accuracyBonusRun;
    this.slotBonusRun = snap.slotBonusRun;
    this.anomalyResistRun = snap.anomalyResistRun;
    this.gameoverInfo = snap.gameoverInfo;
    this.surfacedInfo = snap.surfacedInfo;
    this.log = snap.log.map((l) => ({ ...l }));
    this.equipStats = { ...snap.equipStats };
    this.reduceMotion = !!snap.save.settings?.reduceMotion;
    // 动画中的阶段（下潜/钻进）无法精确恢复：回到观察层重新决策，不丢失任何已获得资源
    if (this.phase === "descending" || this.phase === "drilling") {
      this.phase = "observe";
      this.drillProgress = 0;
      this.drillHeat = 0;
      this.logAdd("重新上线：恢复至当前层观察状态", "info");
    }
    // 视觉状态重置
    this.particles = [];
    this.floatTexts = [];
    this.shake = 0;
    this.flash = 0;
    this.wallHole = 0;
    this.rockScroll = 0;
    this.rockSwoosh = 1;
    this.oreGlints = [];
    this.eyes = [];
    this.audio.play("ambient");
    this.pushUi();
  }

  chooseMode(mode: DrillMode): void {
    if (this.phase !== "observe") return;
    if (this.power <= 0) { this.logAdd("电量不足，无法钻进", "bad"); return; }
    if (mode === "cautious" && this.cautiousCooldown > 0) {
      this.logAdd(`钻机仍在冷却（还需 ${this.cautiousCooldown} 层），无法稳妥钻进`, "bad");
      return;
    }
    this.drillMode = mode;
    this.standardStopped = false;
    this.drillHeat = 0;
    if (mode === "overload" && this.layer) {
      this.layer.ores = overloadOrePool(this.depth, this.rnd);
      this.logAdd("超载钻进：稀有矿权重提升！", "good");
    }
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
    this.revealLevel = "full";
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

  useItem(slotId: string): void {
    if (this.phase !== "observe" && this.phase !== "result" && this.phase !== "blackmarket") return;
    const idx = this.bag.findIndex((s) => s.slotId === slotId);
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
      case "repair_plus":
        this.durability = this.maxDurability;
        this.logAdd(`${def.name}：耐久完全恢复`, "good");
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
      case "disaster_guard":
        this.disasterGuardLayers = 5; // 50m = 5 层
        this.logAdd("应急锚点展开：接下来 50m 内灾难事故降级为严重事故", "good");
        break;
      case "stabilize":
        this.disasterGauge = Math.max(0, this.disasterGauge - 30);
        this.logAdd(`${def.name}：灾难累计值 -30（当前 ${Math.round(this.disasterGauge)}）`, "good");
        break;
    }
    this.bag.splice(idx, 1);
    this.audio.play("support");
    this.pushUi();
  }

  discardSlot(slotId: string): void {
    if (this.phase !== "result" && this.phase !== "observe" && this.phase !== "blackmarket") return;
    const idx = this.bag.findIndex((s) => s.slotId === slotId);
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
    // v6.2：非撤离点禁止返回地面，只能继续下潜到撤离点撤离
    if (!this.evacAvailable) {
      this.logAdd("此处没有撤离点，无法返回地面——继续下潜寻找撤离点", "bad");
      this.audio.play("warning");
      return;
    }
    this.evacuate(false);
  }

  emergencyRetreat(): void {
    if (this.phase !== "hazard") return;
    const ss = safetyStats(this.save.upgrades.safety);
    const overload = this.slotRatio() >= 1 ? 0.12 : 0;
    if (this.rnd() < ss.retreatSuccess - overload) {
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
        if (this.rnd() < risk) {
          this.audio.play("accident");
          this.logAdd("驱赶失败！怪物反击造成事故", "bad");
          this.applyAccident("minor");
        } else {
          this.logAdd("驱赶成功，怪物退入黑暗", "good");
          this.scaredThisRun++;
          this.save.stats.creaturesScared++;
          this.save.codex.creatures++;
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
        if (this.rnd() < risk) {
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
    const baseCount = 2 + Math.floor(this.rnd() * 2);
    const yields = rollOreYield(this.depth, this.layer.ores, this.layer.quality, baseCount, this.rnd);
    const gained = this.scaleYields(yields, mult, this.combo);
    const added = this.addOresToBag(gained, []);
    const value = added.reduce((s, a) => s + this.oreUnitValue(a.id, a.quality) * a.count, 0);
    this.milkCount++;
    this.audio.play("milking");
    this.logAdd(`榨取矿脉 +${fmt(value)}（第 ${this.milkCount} 次）`, "good");
    const risk = Math.min(0.85, this.baseRisk() + extraRisk + (this.slotRatio() >= 1 ? 0.08 : 0));
    const milkSev = this.rollRisk(risk);
    if (this.runEnded) return;
    if (milkSev) {
      this.audio.play("warning");
      this.logAdd("榨取时岩层剧烈震动……", "warn");
      this.applyAccident(milkSev);
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

  // v4：稳妥/标准模式中途收手——按当前进度结算部分收益
  drillStop(): void {
    if (this.phase !== "drilling") return;
    if (this.drillMode === "overload") return;
    if (this.standardStopped) {
      this.logAdd("本层已经收手过一次", "warn");
      return;
    }
    this.standardStopped = true;
    const frac = Math.max(0.3, Math.min(1, this.drillProgress + 0.15));
    this.logAdd(`中途收手（进度 ${Math.round(frac * 100)}%），结算部分收益`, "info");
    this.resolveDrill({ stopFraction: frac });
  }

  // v4：超载模式释放热量——热量越高收益越高，满 100 会过载受损
  drillRelease(): void {
    if (this.phase !== "drilling" || this.drillMode !== "overload") return;
    const heat = this.drillHeat;
    if (heat <= 0) return;
    const burst = 1 + Math.min(1, heat / 100) * 0.8;
    this.logAdd(`释放热量（${Math.round(heat)}%）！收益 ×${burst.toFixed(2)}`, "good");
    this.audio.play("success");
    // 范围爆破：一次结算时额外穿透一层
    this.resolveDrill({ burst, blast: this.overclockChip || heat >= 60 });
  }

  // v7：深渊生存者 —— 消耗 Combo 强制撤离（每局一次，非撤离点也可用）
  guaranteedEvac(): void {
    if (this.phase !== "observe" && this.phase !== "result") return;
    if (this.archetype !== "survivor" || this.evacGuaranteed || this.evacAvailable) return;
    if (this.combo < 4) {
      this.logAdd("需要至少 Combo ×4 才能强制撤离", "bad");
      return;
    }
    this.combo = 1;
    this.evacGuaranteed = true;
    this.logAdd("深渊生存者：消耗全部 Combo，强制撤离！", "good");
    this.finishRun({ evac: "normal" });
  }

  // ---------------- 黑市 ----------------

  openBlackMarket(): void {
    if (this.challenge.includes("no_blackmarket")) {
      this.logAdd("挑战「与世隔绝」生效：本局无法进入黑市", "warn");
      return;
    }
    if (this.phase !== "result" || !this.canBlackMarket) return;
    const favor = Math.min(5, this.save.favor + (this.hasBuff("favor") ? 1 : 0));
    // v6.1：每次遇到新的黑市（不同深度）自动上新；同一黑市内离开再进保持货架；售罄自动补货
    if (!this.bmGenerated || this.bmStock.length === 0 || this.depth !== this.bmEncounterDepth) {
      this.bmStock = generateBmStock(this.depth, favor, {
        sellBoost: this.hasBuff("sell_boost"),
        discount: this.hasBuff("bm_discount") || this.bmDiscountRun > 0,
      });
      this.bmGenerated = true;
      this.bmEncounterDepth = this.depth;
    }
    this.phase = "blackmarket";
    this.audio.play("click");
    this.pushUi();
  }

  bmSell(slotId: string, count: number): void {
    if (this.phase !== "blackmarket") return;
    const idx = this.bag.findIndex((s) => s.slotId === slotId);
    if (idx < 0) return;
    const slot = this.bag[idx];
    if (slot.kind !== "ore" || slot.quality === undefined) return;
    const sell = Math.max(1, Math.min(count, slot.count));
    const favor = Math.min(5, this.save.favor + (this.hasBuff("favor") ? 1 : 0));
    // v7：拾荒商人 —— 黑市售价 +10%
    const ratio = Math.min(0.85, blackSellRatio(favor, this.hasBuff("sell_boost")) + this.scavengerSellBoost());
    const cash = Math.round(sell * slot.unitValue * ratio);
    if (cash <= 0) return;
    this.pocket += cash;
    slot.count -= sell;
    slot.value = slot.count * slot.unitValue;
    this.loadValue = Math.max(0, this.loadValue - sell * slot.unitValue);
    if (slot.count <= 0) this.bag.splice(idx, 1);
    this.save.stats.totalSells += sell;
    this.save.stats.bmTrades++;
    const d = this.ensureDaily();
    d.tasks.task_bmtrade = (d.tasks.task_bmtrade ?? 0) + 1;
    d.tasks.task_sell = (d.tasks.task_sell ?? 0) + sell;
    this.logAdd(`黑市售出 ${slot.name} ×${sell}，+${fmt(cash)}`, "good");
    this.audio.play("click");
    persistSave(this.save);
    this.pushUi();
  }

  bmBuy(index: number, pay: "cash" | "ore"): void {
    if (this.phase !== "blackmarket") return;
    const item = this.bmStock[index];
    if (!item || item.stock <= 0) return;
    if (item.kind === "consumable" && this.usedSlots() >= this.slots) {
      this.logAdd("背包已满，无法购买", "warn");
      this.audio.play("warning");
      return;
    }
    if (pay === "cash") {
      // v7：拾荒商人 —— 可赊账一次（现金可为负，结算时从仓库扣回）
      if (this.pocket < item.cashPrice && this.archetype === "scavenger" && !this.creditUsed) {
        this.creditUsed = true;
        this.pocket -= item.cashPrice;
        this.logAdd(`拾荒商人赊账：购入 ${item.name}（结算时扣款）`, "good");
      } else if (this.pocket < item.cashPrice) {
        this.logAdd("随身现金不足", "bad");
        return;
      } else {
        this.pocket -= item.cashPrice;
      }
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
        slotId: this.newSlotId(), key: "item:" + item.id, kind: "item", id: item.id, count: 1,
        name: item.name, color: item.color, icon: item.icon, value: 0, unitValue: 0,
      });
      this.logAdd(`购入 ${item.name}`, "good");
    } else {
      const inst = makeEquipmentInstance(item.id);
      this.runPendingEquipment.push(inst);
      this.logAdd(`购入装备 ${item.name}（成功撤离后入库）`, "good");
    }
    // 库存扣减，售完下架
    item.stock -= 1;
    this.save.stats.bmTrades++;
    const d = this.ensureDaily();
    d.tasks.task_bmtrade = (d.tasks.task_bmtrade ?? 0) + 1;
    if (item.stock <= 0) this.bmStock.splice(index, 1);
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
    this.power = Math.min(this.maxPower, this.power + 30);
    this.logAdd("黑市维修完成：耐久 +40%，电量 +30", "good");
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
    // 保留货架：同一黑市再次进入不刷新；下个黑市（新深度）自动上新（也可付费手动刷新）
    this.pushUi();
  }

  // 刷新货架：消耗随身现金，重新随机生成货架
  bmRefreshCost(): number {
    return Math.round(80 + this.depth * 0.6);
  }

  bmRefresh(): void {
    if (this.phase !== "blackmarket") return;
    const cost = this.bmRefreshCost();
    if (this.pocket < cost) {
      this.logAdd("随身现金不足，无法刷新货架", "bad");
      this.audio.play("warning");
      return;
    }
    this.pocket -= cost;
    const favor = Math.min(5, this.save.favor + (this.hasBuff("favor") ? 1 : 0));
    this.bmStock = generateBmStock(this.depth, favor, {
      sellBoost: this.hasBuff("sell_boost"),
      discount: this.hasBuff("bm_discount") || this.bmDiscountRun > 0,
    });
    this.bmGenerated = true;
    this.bmEncounterDepth = this.depth;
    this.logAdd("货架已刷新", "good");
    this.audio.play("click");
    this.pushUi();
  }

  // v7：拾荒商人 —— 黑市售价 +10%、折扣 +5%
  private scavengerSellBoost(): number { return this.archetype === "scavenger" ? 0.1 : 0; }
  private scavengerBuyDiscount(): number { return this.archetype === "scavenger" ? 0.05 : 0; }

  // ---------------- 强盗 ----------------

  banditChoice(action: "pay" | "give" | "fight"): void {
    if (this.phase !== "bandit") return;
    // v7：减免钳制在 90% 以内，避免极品装备导致负损失/反向收益
    const reduce = Math.max(0.1, 1 - this.banditReduce / 100);
    if (action === "pay") {
      if (this.pocket <= 0) {
        this.logAdd("随身没有现金，无法支付", "bad");
        this.audio.play("warning");
        return;
      }
      const cost = Math.max(1, Math.round(this.pocket * 0.1 * reduce));
      this.pocket = Math.max(0, this.pocket - cost);
      this.logAdd(`强盗勒索：支付 ${fmt(cost)} 现金`, "warn");
    } else if (action === "give") {
      if (this.loadValue <= 0) {
        this.logAdd("背包里没有矿石，无法上贡", "bad");
        this.audio.play("warning");
        return;
      }
      const lost = this.removeOreValue(0.12 * reduce);
      this.logAdd(`强盗抢走价值 ${fmt(lost)} 的矿石`, "bad");
    } else {
      // v7：战斗胜负也走局内 RNG（种子可复现）
      if (this.rnd() < 0.5) {
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
    // v7：折叠空间 —— 特殊物品（消耗品等）不占格子
    if (this.pocketDim) return this.bag.filter((s) => s.kind === "ore").length;
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

  // v9：危险货物 —— 少数深渊矿物携带时会吸引风险（每堆 0..0.3）
  private dangerForOre(id: OreId, quality: OreQuality): number {
    const d: Record<OreId, number> = {
      stone: 0, copper: 0, iron: 0, silver: 0, gold: 0,
      diamond: quality === "legendary" ? 0.05 : quality === "fine" ? 0.03 : 0,
      crystal: quality === "legendary" ? 0.14 : quality === "fine" ? 0.09 : 0.05,
      unknown: quality === "legendary" ? 0.2 : quality === "fine" ? 0.14 : 0.08,
    };
    return d[id] ?? 0;
  }

  // v9：图鉴研究 —— 单矿物研究等级（0..10）
  private researchLevel(key: string): number {
    return Math.min(10, Math.max(0, this.save.codex?.research?.[key] ?? 0));
  }

  private totalResearchLevels(): number {
    const r = this.save.codex?.research ?? {};
    let sum = 0;
    for (const v of Object.values(r)) sum += Math.min(10, Math.max(0, v));
    return sum;
  }

  private researchValueMult(key: string): number {
    return 1 + this.researchLevel(key) * 0.02; // v9：每级 +2% 对应矿石价值
  }

  private oreUnitValue(id: OreId, quality: OreQuality): number {
    return oreUnitValueBase(this.depth, id, quality) * (1 + this.valueBonus / 100) * this.researchValueMult(oreStackKey(id, quality));
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
    // v7：废料护甲 —— 耐久越低收益越高（最高 +30%）
    const scrapMult = this.scrapArmor ? 1 + (1 - this.durability / Math.max(1, this.maxDurability)) * 0.3 : 1;
    let count = Math.round(base.length * mult * combo * diff.incomeMult * (1 - this.wearPenalty) * scrapMult);
    count = Math.max(1, Math.min(99, count));
    const map = new Map<string, GainedOre>();
    for (let i = 0; i < count; i++) {
      const y = base[i % base.length];
      let q = y.quality;
      // v7：品质提升统一走局内 RNG（幸运镐 + 地质实验室 + 增益），保证种子可复现
      const qualityChance = this.qualityBonus + this.luckyPick + this.qualityBoostRun;
      if (qualityChance > 0 && this.rnd() * 100 < qualityChance) q = upgradeQuality(q);
      const key = oreStackKey(y.id, q);
      const cur = map.get(key);
      if (cur) cur.count++;
      else map.set(key, { id: y.id, quality: q, count: 1 });
    }
    return [...map.values()];
  }

  // 入包：同 oreId+quality 先填满所有可合并堆（避免碎片化），再开新格；格子不够的部分散落损失
  private addOreToBag(id: OreId, quality: OreQuality, count: number): number {
    const key = oreStackKey(id, quality);
    const unit = this.oreUnitValue(id, quality);
    const cap = this.stackCap;
    let remaining = count;
    // v7：先填满所有同 key 的已有堆（修复“第一个堆满就新建第三堆”的碎片化）
    for (const slot of this.bag) {
      if (remaining <= 0) break;
      if (slot.kind === "ore" && slot.key === key && slot.count < cap) {
        const add = Math.min(remaining, cap - slot.count);
        slot.count += add;
        slot.value = slot.count * unit;
        this.loadValue += add * unit;
        this.minedThisRun += add;
        remaining -= add;
      }
    }
    while (remaining > 0) {
      if (this.usedSlots() >= this.slots) {
        // v7：磁力收纳 / 牵引光束 —— 满格时自动压缩同 key 碎片堆腾出格子
        if (this.autoCompress && this.compressBag()) continue;
        break;
      }
      const add = Math.min(remaining, cap);
      this.bag.push({
        slotId: this.newSlotId(),
        key, kind: "ore", id, quality, count: add,
        name: this.oreSlotName(id, quality),
        color: ORE_QUALITIES[quality].color,
        icon: ORE_QUALITIES[quality].icon,
        value: add * unit, unitValue: unit,
        danger: this.dangerForOre(id, quality), // v9：危险货物（深渊矿物携带风险）
      });
      this.loadValue += add * unit;
      this.minedThisRun += add;
      remaining -= add;
    }
    return remaining;
  }

  private newSlotId(): string {
    return "s" + this.nextSlotId++;
  }

  // v7：把同 key 的碎片矿堆合并进第一个堆（不超过堆叠上限），腾出格子
  private compressBag(): boolean {
    const groups = new Map<string, BagSlot[]>();
    for (const s of this.bag) {
      if (s.kind !== "ore") continue;
      const list = groups.get(s.key);
      if (list) list.push(s);
      else groups.set(s.key, [s]);
    }
    let freed = false;
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const cap = this.stackCap;
      list.sort((a, b) => a.unitValue - b.unitValue);
      const primary = list[0];
      for (let i = 1; i < list.length; i++) {
        const s = list[i];
        const add = Math.min(s.count, cap - primary.count);
        if (add > 0) {
          primary.count += add;
          primary.value = primary.count * primary.unitValue;
          if (primary.id && primary.quality) primary.danger = this.dangerForOre(primary.id as OreId, primary.quality);
          s.count -= add;
          s.value = s.count * s.unitValue;
        }
        if (s.count <= 0) {
          this.bag.splice(this.bag.indexOf(s), 1);
          freed = true;
        }
      }
    }
    return freed;
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
        slotId: this.newSlotId(),
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
        danger: this.dangerForOre(a.id, a.quality), // v9：危险货物
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
        cur.danger = Math.max(cur.danger ?? 0, s.danger ?? 0);
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

  // v7：所有层生成统一走同一精度口径（含流派精度加成），避免多路径参数漂移
  // v8：减少动态时粒子规模缩到 25%
  private particleMult(): number { return this.reduceMotion ? 0.25 : 1; }

  private currentAccuracy(): number {
    const det = detectionStats(this.save.upgrades.detection);
    // v9：图鉴研究 —— 总研究等级小幅提升探测精度（最高 +12%）
    return Math.min(1, det.accuracy + this.equipStats.accuracyBonus / 100 + this.accuracyBonusRun / 100 + Math.min(0.12, this.totalResearchLevels() * 0.004));
  }

  private genLayer(depth: number, accuracy: number): Layer {
    let l: Layer | null = null;
    // v7：预览层与实际消费同一对象（确定性）：预生成且深度匹配时直接复用
    if (this.previewLayer && this.previewLayer.depth === depth) {
      l = this.previewLayer;
      this.previewLayer = null;
    }
    if (!l) l = generateLayer(depth, { accuracy, rng: this.rnd });
    // v7：路线增益在接下来 2 层内持续生效（品质/风险修正）
    if (this.routeBuff && this.routeBuff.layersLeft > 0) {
      const order: Array<"barren" | "normal" | "rich" | "legendary"> = ["barren", "normal", "rich", "legendary"];
      const qi = order.indexOf(l.quality);
      l.quality = order[Math.max(0, Math.min(order.length - 1, qi + (this.routeBuff.qualityShift ?? 0)))];
      l.collapseRisk = Math.min(0.9, Math.max(0.02, l.collapseRisk + (this.routeBuff.riskShift ?? 0)));
      l.instability = l.collapseRisk;
    }
    // v4 信息分层：未探测时只显示征兆；探测器/高等级探测/特性可揭示真实信息
    if (this.nextTransparent) {
      this.revealLevel = "full";
      l.revealed = { collapseRisk: l.collapseRisk, quality: l.quality, hazard: l.hazard };
      this.nextTransparent = false;
    } else if (this.revealQualityAuto || this.save.upgrades.detection >= 4) {
      this.revealLevel = "basic";
      l.revealed = { collapseRisk: l.collapseRisk, quality: l.quality, hazard: l.hazard };
    } else {
      this.revealLevel = "none";
    }
    return l;
  }

  // 进入下一层（10m），并根据深度触发：检查点营地 / Boss / 模块 / 路线分岔 / 特殊房间
  private advanceLayer(): void {
    this.depth += 10;
    this.refreshEvac();
    if (this.evacAvailable) this.applyEvacSupply();
    this.retreatBlocked = Math.max(0, this.retreatBlocked - 1);
    this.cautiousCooldown = Math.max(0, this.cautiousCooldown - 1);
    this.creatureImmune = Math.max(0, this.creatureImmune - 1);
    this.disasterGuardLayers = Math.max(0, this.disasterGuardLayers - 1);
    if (this.routeBuff && --this.routeBuff.layersLeft <= 0) this.routeBuff = null;
    this.milkCount = 0;
    this.supportsUsedThisLayer = false;
    this.detectorDisabled = false;
    this.anomalyDouble = false;
    this.anomalyDoubleLoss = false;
    this.unlockCheckpoints();
    const d = this.ensureDaily();
    d.tasks.task_depth = Math.max(d.tasks.task_depth ?? 0, this.depth);
    const det = detectionStats(this.save.upgrades.detection);
    this.layer = this.genLayer(this.depth, this.currentAccuracy());
    this.applyPreview(det.previewChance);
    this.applyAnomalyOnEntry();
    this.roomView = null;
    this.routeOptions = null;
    this.moduleOptions = null;
    this.baseView = null;
    this.bossState = null;
    this.wallHole = 0;
    this.rockSwoosh = 1;
    this.oreGlints = [];
    this.eyes = [];
    this.audio.play("drillStop");
    this.audio.play("retreat");

    // v4：事件优先级 = 检查点营地 > Boss > 模块里程碑 > 路线分岔 > 特殊房间 > 正常下降
    if (CHECKPOINTS.includes(this.depth) && this.depth > 0 && !this.challenge.includes("no_checkpoint")) {
      this.enterBase();
    } else if (this.depth === 500 || this.depth === 950) {
      this.enterBoss();
    } else if (this.depth % 100 === 50 && !this.moduleMilestoneDone.includes(this.depth)) {
      this.enterModule();
    } else if (this.depth % 30 === 0 && this.depth > 0) {
      this.enterRoute();
    } else if (this.rnd() < 0.06 + (this.routeBuff?.roomBoost ? 0.15 : 0)) {
      this.enterRoom();
    } else {
      this.phase = "descending";
      this.phaseTimer = 1.15;
    }
    this.pushUi();
  }

  // ================= v4 事件入口 =================

  private enterRoom(): void {
    const pool = ROOM_ORDER.filter((r) => !this.visitedRooms.includes(r));
    const id: RoomId = pool.length ? pool[Math.floor(this.rnd() * pool.length)] : ROOM_ORDER[0];
    const def = ROOMS[id];
    this.roomView = {
      id,
      title: def.title,
      desc: def.desc,
      options: def.options.map((o) => ({ ...o })),
    };
    this.phase = "room";
    this.audio.play("click");
    this.logAdd(`发现特殊房间：${def.title}`, "warn");
  }

  private enterRoute(): void {
    this.routeOptions = [
      { id: "rich", name: "富矿脉", desc: "沿矿脉深入，品质更高但岩层更不稳定", riskLabel: "塌方风险高", rewardLabel: "高品质矿石概率↑", icon: "💎", qualityShift: 1, riskShift: 0.08 },
      { id: "facility", name: "旧设施", desc: "探索废弃设施，可能找到补给或触发事件", riskLabel: "风险中等", rewardLabel: "装备/补给机会", icon: "🏭", qualityShift: 0, riskShift: -0.03, roomBoost: 0.15 },
      { id: "safe", name: "安全井", desc: "走支撑良好的旧井道，收益较低但很安全", riskLabel: "风险低", rewardLabel: "收益略降·撤离稳妥", icon: "🛗", qualityShift: -1, riskShift: -0.08 },
    ];
    this.phase = "route";
    this.audio.play("click");
    this.logAdd("前方出现分岔路线，需要选择前进方向", "info");
  }

  private enterModule(): void {
    this.moduleOptions = pickModules(3, this.rnd, this.modules as ModuleId[]);
    this.moduleMilestoneDone.push(this.depth);
    this.phase = "module";
    this.audio.play("click");
    this.logAdd("到达一处古老补给站，可以安装一件装置", "good");
  }

  private enterBase(): void {
    const built = !!this.baseBuilt[this.depth];
    const options = built
      ? [
          { id: "repair", label: "临时检修", desc: "钻机耐久 +20%（每次营地限一次）", icon: "🔧" },
          { id: "storage", label: "扩展货舱", desc: "本局背包格 +3", icon: "📦" },
          { id: "detect", label: "补充探测器", desc: "探测器 +2", icon: "📡" },
          { id: "trade", label: "黑市渠道", desc: "本局黑市折扣 +10%", icon: "🪙" },
          { id: "leave", label: "继续深入", desc: "不停留，直接下潜", icon: "🚶" },
        ]
      : [
          { id: "build", label: "交付材料·建立营地", desc: "需要 5 个普通铜矿；建立后可获得补给选择", icon: "🏗️" },
          { id: "leave", label: "暂不建立", desc: "继续深入", icon: "🚶" },
        ];
    this.baseView = {
      depth: this.depth,
      built,
      needOre: built ? null : { id: "copper", quality: "normal", count: 5 },
      options,
    };
    this.phase = "base";
    this.audio.play("click");
    this.logAdd(`${this.depth}m 处有一座旧升降井检查点`, "info");
  }

  private enterBoss(): void {
    const def = this.depth >= 950
      ? { id: "abyss_lord", name: "深渊之主", hp: 150, maxHp: 150 }
      : { id: "magma_behemoth", name: "岩浆巨兽", hp: 100, maxHp: 100 };
    this.bossState = { ...def };
    this.phase = "boss";
    this.audio.play("creature");
    this.logAdd(`${def.name} 挡住了去路！`, "bad");
  }

  private continueToDrill(): void {
    // 事件结算完成后进入该层钻进观察
    this.phase = "descending";
    this.phaseTimer = 0.8;
  }

  // ================= v4 事件操作 =================

  routeChoose(id: string): void {
    if (this.phase !== "route") return;
    const route = this.routeOptions?.find((r) => r.id === id);
    if (!route) return;
    this.routeOptions = null;
    // 路线修正应用到当前层
    if (this.layer) {
      const order: Array<"barren" | "normal" | "rich" | "legendary"> = ["barren", "normal", "rich", "legendary"];
      const i = order.indexOf(this.layer.quality);
      const shift = route.qualityShift ?? 0;
      this.layer.quality = order[Math.max(0, Math.min(order.length - 1, i + shift))];
      this.layer.collapseRisk = Math.min(0.9, Math.max(0.02, this.layer.collapseRisk + (route.riskShift ?? 0)));
      this.layer.instability = this.layer.collapseRisk;
    }
    this.routeBuff = {
      qualityShift: route.qualityShift ?? 0,
      riskShift: route.riskShift ?? 0,
      layersLeft: 2,
      roomBoost: route.roomBoost ?? 0,
    };
    this.logAdd(`选择「${route.name}」路线`, "good");
    this.audio.play("click");
    this.continueToDrill();
    this.pushUi();
  }

  roomChoose(optionId: string): void {
    if (this.phase !== "room" || !this.roomView) return;
    const room = this.roomView;
    const opt = room.options.find((o) => o.id === optionId);
    if (!opt) return;
    const roomId = room.id;
    if (!this.visitedRooms.includes(roomId)) {
      this.visitedRooms.push(roomId);
      if (!this.save.codex.rooms.includes(roomId)) this.save.codex.rooms.push(roomId);
    }
    this.roomView = null;
    this.audio.play("click");
    // 结算选项效果
    switch (roomId) {
      case "minecart":
        if (optionId === "ride") {
          this.depth += 20;
          this.depthDisplay = this.depth;
          this.logAdd("矿车呼啸而下，直接下潜 20m！", "good");
          this.phase = "descending";
          this.phaseTimer = 0.4;
          this.pushUi();
          return;
        } else if (optionId === "scrap") {
          this.durability = Math.min(this.maxDurability, this.durability + this.maxDurability * 0.2);
          this.logAdd("拆解矿车获得材料：耐久 +20%", "good");
        }
        break;
      case "collapsed_warehouse":
        if (optionId === "search") {
          if (this.rnd() < 0.25) {
            this.audio.play("accident");
            this.applyAccident("minor");
            if (this.runEnded) { this.pushUi(); return; }
            this.logAdd("翻找时岩层塌落，受了点小伤", "bad");
          } else {
            const ids = Object.keys(CONSUMABLES);
            const pick = ids[Math.floor(this.rnd() * ids.length)];
            const def = CONSUMABLES[pick];
            if (def && this.usedSlots() < this.slots) {
              this.bag.push({ slotId: this.newSlotId(), key: "item:" + pick, kind: "item", id: pick, count: 1, name: def.name, color: def.color, icon: def.icon, value: 0, unitValue: 0 });
              this.logAdd(`搜寻到补给：${def.name}`, "good");
            } else {
              this.pocket += 40;
              this.logAdd("找到一小袋现金 +40", "good");
            }
          }
        } else if (optionId === "clear") {
          this.durability = Math.max(0, this.durability - 8);
          this.pocket += 60;
          this.logAdd("清理通道，获得报酬 +60 现金", "good");
        }
        break;
      case "bm_backdoor":
        if (optionId === "trade") {
          const ids = Object.keys(CONSUMABLES);
          const pick = ids[Math.floor(this.rnd() * ids.length)];
          const def = CONSUMABLES[pick];
          const price = Math.round(def.basePrice * 0.8);
          if (this.pocket >= price) {
            this.pocket -= price;
            this.bag.push({ slotId: this.newSlotId(), key: "item:" + pick, kind: "item", id: pick, count: 1, name: def.name, color: def.color, icon: def.icon, value: 0, unitValue: 0 });
            this.logAdd(`暗门交易：购入 ${def.name}（8 折）`, "good");
          } else {
            this.logAdd("现金不足，暗门商人摇头离开", "warn");
          }
        } else if (optionId === "tip") {
          this.save.favor = Math.min(5, this.save.favor + 1);
          this.logAdd("向地面举报黑市，好感 +1", "good");
        }
        break;
      case "geolab":
        if (optionId === "analyze") {
          this.qualityBoostRun += 15;
          this.logAdd("研究岩样：本局高品质矿石概率 +15%", "good");
        } else if (optionId === "extract") {
          const cash = Math.round(this.loadValue * 0.1);
          this.pocket += cash;
          this.logAdd(`提取数据变现：+${fmt(cash)} 现金`, "good");
        }
        break;
      case "nest":
        if (optionId === "steal") {
          if (this.rnd() < 0.5) {
            const y = rollOreYield(this.depth, this.layer?.ores ?? ["copper"], "rich", 3 + Math.floor(this.rnd() * 3), this.rnd);
            const added = this.addOresToBag(this.scaleYields(y, 1, this.combo), []);
            const v = added.reduce((s, a) => s + this.oreUnitValue(a.id, a.quality) * a.count, 0);
            this.logAdd(`偷得稀有矿卵 +${fmt(v)}`, "good");
          } else {
            this.audio.play("accident");
            this.applyAccident("severe");
            if (this.runEnded) { this.pushUi(); return; }
            this.logAdd("巢穴被惊动！被生物袭击", "bad");
          }
        } else if (optionId === "bait") {
          this.creatureImmune = 3;
          this.logAdd("设置诱饵：接下来 3 层不会遭遇地底生物", "good");
        }
        break;
      case "cooling_spring":
        if (optionId === "cool") {
          this.overheat = 0;
          this.heatGainMult *= 0.8;
          this.logAdd("灌满冷却剂：热量清零，本局热量增长 -20%", "good");
        } else if (optionId === "soak") {
          this.durability = Math.min(this.maxDurability, this.durability + this.maxDurability * 0.25);
          this.logAdd("浸泡检修：耐久 +25%", "good");
        }
        break;
      case "ancient_gate":
        if (optionId === "puzzle") {
          const r = this.rnd();
          if (r < 0.34) {
            const y = rollOreYield(this.depth, this.layer?.ores ?? ["copper"], "legendary", 5 + Math.floor(this.rnd() * 4), this.rnd);
            const added = this.addOresToBag(this.scaleYields(y, 1, this.combo), []);
            const v = added.reduce((s, a) => s + this.oreUnitValue(a.id, a.quality) * a.count, 0);
            this.logAdd(`破解机关！丰厚的矿石奖励 +${fmt(v)}`, "good");
          } else if (r < 0.67) {
            this.moduleOptions = pickModules(3, this.rnd, this.modules as ModuleId[]);
            this.phase = "module";
            this.audio.play("click");
            this.logAdd("机械门内藏着一件古老装置", "good");
            this.pushUi();
            return;
          } else {
            this.audio.play("accident");
            this.applyAccident("severe");
            if (this.runEnded) { this.pushUi(); return; }
            this.logAdd("机关触发陷阱！", "bad");
          }
        } else if (optionId === "force") {
          this.durability = Math.max(0, this.durability - this.maxDurability * 0.15);
          this.logAdd("强行破门：耐久 -15%", "warn");
        }
        break;
      case "unstable_shaft":
        if (optionId === "escape") {
          this.logAdd("沿通风井紧急撤离！", "good");
          this.finishRun();
          return;
        } else if (optionId === "reinforce") {
          this.riskReduce = Math.min(0.5, this.riskReduce + 0.25);
          this.logAdd("加固井壁：本局塌方风险 -25%", "good");
        }
        break;
    }
    this.continueToDrill();
    this.pushUi();
  }

  chooseModule(moduleId: string): void {
    if (this.phase !== "module") return;
    const opt = this.moduleOptions?.find((m) => m.id === moduleId);
    if (!opt) return;
    const id = opt.id as ModuleId;
    this.moduleOptions = null;
    if (!this.modules.includes(id)) this.modules.push(id);
    if (!this.save.codex.modules.includes(id)) this.save.codex.modules.push(id);
    this.audio.play("success");
    // 立即生效的模块
    if (id === "beacon") this.nextTransparent = true;
    if (id === "shield") { this.shieldModuleUsed = true; this.shieldActive = true; }
    if (id === "scanner") this.revealQualityAuto = true;
    if (id === "tractor") this.autoCompress = true;
    if (id === "gas_engine") this.gasConvert = true;
    if (id === "compactor") this.stackCap = 999;
    if (id === "coolant") { this.heatGainMult *= 0.6; }
    if (id === "overclock") this.overloadGainBonus += 25;
    if (id === "vent") this.overloadRiskMult *= 0.6;
    if (id === "drill_head") this.pierceCapBonus += 3;
    if (id === "dredge") { /* 结算时生效 */ }
    this.logAdd(`安装装置：${opt.name}`, "good");
    this.continueToDrill();
    this.pushUi();
  }

  baseChoose(optionId: string): void {
    if (this.phase !== "base" || !this.baseView) return;
    const base = this.baseView;
    if (!base.built && optionId === "build") {
      const need = base.needOre!;
      const key = oreStackKey(need.id as OreId, need.quality);
      const slot = this.bag.find((s) => s.key === key && s.kind === "ore");
      if (!slot || slot.count < need.count) {
        this.logAdd(`材料不足：需要 ${ORE_QUALITIES[need.quality].name}${ORES[need.id as OreId].name} ×${need.count}`, "bad");
        return;
      }
      slot.count -= need.count;
      slot.value = slot.count * slot.unitValue;
      this.loadValue = Math.max(0, this.loadValue - need.count * slot.unitValue);
      if (slot.count <= 0) this.bag.splice(this.bag.indexOf(slot), 1);
      this.baseBuilt[this.depth] = true;
      base.built = true;
      base.needOre = null;
      base.options = [
        { id: "repair", label: "临时检修", desc: "钻机耐久 +20%（每次营地限一次）", icon: "🔧" },
        { id: "storage", label: "扩展货舱", desc: "本局背包格 +3", icon: "📦" },
        { id: "detect", label: "补充探测器", desc: "探测器 +2", icon: "📡" },
        { id: "trade", label: "黑市渠道", desc: "本局黑市折扣 +10%", icon: "🪙" },
        { id: "leave", label: "继续深入", desc: "不停留，直接下潜", icon: "🚶" },
      ];
      this.logAdd("营地建立完成！可以选择补给方向", "good");
      this.audio.play("support");
      this.pushUi();
      return;
    }
    if (!base.built) {
      this.baseView = null;
      this.continueToDrill();
      this.pushUi();
      return;
    }
    // 已建成：选择一项补给后离开
    switch (optionId) {
      case "repair":
        this.durability = Math.min(this.maxDurability, this.durability + this.maxDurability * 0.2);
        this.power = Math.min(this.maxPower, this.power + 30);
        this.logAdd("营地检修：耐久 +20%，电量 +30", "good");
        break;
      case "storage":
        this.slots += 3;
        this.logAdd("扩展货舱：背包格 +3", "good");
        break;
      case "detect":
        this.detectors += 2;
        this.logAdd("补充探测器：探测器 +2", "good");
        break;
      case "trade":
        this.bmDiscountRun = (this.bmDiscountRun ?? 0) + 0.1;
        this.logAdd("黑市渠道：本局黑市折扣 +10%", "good");
        break;
      case "leave":
        break;
      default:
        return;
    }
    this.baseView = null;
    this.continueToDrill();
    this.audio.play("click");
    this.pushUi();
  }

  bossAction(actionId: string): void {
    if (this.phase !== "boss" || !this.bossState) return;
    const boss = this.bossState;
    let dmg = 0;
    if (actionId === "drill") {
      this.power = Math.max(0, this.power - 15);
      this.durability = Math.max(0, this.durability - 10);
      dmg = 35;
    } else if (actionId === "dodge") {
      if (this.rnd() < 0.5) {
        dmg = 60;
        this.logAdd("你抓住破绽全力反击！", "good");
      } else {
        this.durability = Math.max(0, this.durability - 20);
        this.logAdd("闪避失败，被巨兽扫中", "bad");
      }
    } else if (actionId === "bribe") {
      if (this.loadValue <= 0) {
        this.logAdd("背包里没有矿石，无法投掷", "bad");
        this.audio.play("warning");
        this.pushUi();
        return;
      }
      const lost = this.removeOreValue(0.1);
      dmg = 70;
      this.logAdd(`投掷矿石吸引注意（损失 ${fmt(lost)}），趁机猛攻`, "warn");
    }
    boss.hp = Math.max(0, boss.hp - dmg);
    // Boss 反击
    if (boss.hp > 0) {
      this.durability = Math.max(0, this.durability - (8 + Math.floor(this.rnd() * 10)));
      this.power = Math.max(0, this.power - 6);
      this.logAdd(`${boss.name} 反击！设备受损`, "bad");
    }
    if (this.durability <= 0 || this.power <= 0) {
      this.endByDisaster();
      return;
    }
    if (boss.hp <= 0) {
      this.audio.play("success");
      this.logAdd(`击败了 ${boss.name}！`, "good");
      this.flash = 0.5;
      this.flashColor = "#ffd166";
      // 奖励：现金 + 高品质矿石
      this.pocket += 120 + Math.floor(this.depth * 0.2);
      const y = rollOreYield(this.depth, this.layer?.ores ?? ["gold"], "legendary", 5 + Math.floor(this.rnd() * 3), this.rnd);
      const added = this.addOresToBag(this.scaleYields(y, 1, this.combo), []);
      const v = added.reduce((s, a) => s + this.oreUnitValue(a.id, a.quality) * a.count, 0);
      this.logAdd(`战利品：+${fmt(v)} 矿石`, "good");
      if (this.rnd() < 0.6 && !this.modules.includes("shield")) {
        this.moduleOptions = pickModules(3, this.rnd, this.modules as ModuleId[]);
        this.phase = "module";
        this.pushUi();
        return;
      }
      this.bossState = null;
      this.continueToDrill();
      this.pushUi();
      return;
    }
    this.pushUi();
  }



  private applyPreview(chance: number): void {
    if (!this.layer || chance <= 0 || this.rnd() >= chance) return;
    // v7：只预生成一次并缓存，预览与实际下一层消费同一对象
    if (!this.previewLayer || this.previewLayer.depth !== this.depth + 10) {
      this.previewLayer = generateLayer(this.depth + 10, { rng: this.rnd });
    }
    this.layer.signals.push(`[预知] 下一层塌方风险：${riskLabel(this.previewLayer.collapseRisk)}`);
  }

  private applyAnomalyOnEntry(): void {
    const l = this.layer;
    if (!l) return;
    if (l.hazard === "anomaly" && l.anomalyEffect) {
      const e = l.anomalyEffect;
      this.anomalySeenThisRun++;
      this.save.stats.anomaliesSeen++;
      if (!this.save.codex.anomalies.includes(e)) this.save.codex.anomalies.push(e);
      if (e.includes("双倍法则")) { this.anomalyDouble = true; this.anomalyDoubleLoss = true; }
      else if (e.includes("单行道")) {
        // v7：深渊生存者 —— 异常转化为增益
        if (this.archetype === "survivor") {
          this.power = Math.min(this.maxPower, this.power + 15);
          this.logAdd("深渊生存者：异常转化为增益，电量 +15", "good");
        } else {
          this.retreatBlocked += 2;
        }
      }
      else if (e.includes("探测干扰")) {
        if (this.archetype === "survivor") {
          this.durability = Math.min(this.maxDurability, this.durability + this.maxDurability * 0.1);
          this.logAdd("深渊生存者：异常转化为增益，耐久 +10%", "good");
        } else {
          this.detectorDisabled = true;
        }
      }
      else if (e.includes("深渊回响")) this.nextTransparent = true;
      this.audio.play("anomaly");
      this.logAdd("深渊异常正在生效……", "warn");
    }
  }

  private baseRisk(useSupport: boolean = this.supportsUsedThisLayer): number {
    const l = this.layer;
    if (!l) return 0.05;
    const ss = supportStats(this.save.upgrades.support);
    // v5 平衡：安全装备每级削减 5% 塌方风险（原 3%），满配 12 级可压至 40%
    let risk = l.collapseRisk * Math.max(0.15, 1 - 0.05 * this.save.upgrades.safety);
    risk *= useSupport ? ss.effect : 1;
    risk *= 1 + this.overheat * 0.004;
    const r = this.slotRatio();
    if (r >= 1) risk += 0.12;
    else if (r > 0.8) risk += 0.06;
    else if (r > 0.6) risk += 0.03;
    // v9：危险货物 —— 携带深渊矿物吸引风险（封顶 +25%）
    const bagDanger = this.bag.reduce((sum, sl) => sum + (sl.danger ?? 0), 0);
    if (bagDanger > 0) risk += Math.min(0.25, bagDanger * 0.35);
    if (this.anomalyDouble) risk *= 1.2;
    // v7：富矿血脉 / 加固井壁 —— 全局风险削减生效
    risk *= Math.max(0.5, 1 - this.riskReduce);
    return Math.max(0.03, Math.min(0.9, risk));
  }

  private rollSeverity(risk: number): "minor" | "severe" | "disaster" {
    const r = this.rnd();
    const severeThresh = 0.62 - risk * 0.25;
    // v5 平衡：灾难基础概率 10% -> 3%（正常路径整体约减半）；
    // 深渊深处存在最低灾难威胁，满配也无法完全规避（1000m 满配约 30%）
    const depthFloor = 0.02 + (this.depth / 1000) * 0.05;
    const disasterP = Math.max(0.03 + risk * 0.25, depthFloor);
    if (r > 1 - disasterP) return "disaster";
    if (r > severeThresh) return "severe";
    return "minor";
  }

  // v6：灾难风险统一入口 —— 累计值模式（默认）与随机概率模式（旧）
  private rollRisk(risk: number): "minor" | "severe" | "disaster" | null {
    if (this.disasterMode === "gauge") return this.gaugeRoll(risk);
    return this.rnd() < risk ? this.rollSeverity(risk) : null;
  }

  // v6：累计值模式 —— 每层风险只转化为"灾难累计值"，不满 100 不直接触发事故；
  // 满 100 触发灾难（护盾/锚点/支撑架可抵挡一次并清零）。随机小事故/严重事故不再单独发生。
  private gaugeRoll(risk: number): "minor" | "severe" | null {
    const delta = Math.min(16, Math.max(0.8, risk * 100 * 0.13)) * this.gaugeGainMult * DIFFICULTY_DEFS[this.difficulty].gaugeMult;
    this.addGauge(delta);
    return null;
  }

  private addGauge(delta: number): void {
    if (this.disasterMode !== "gauge") return;
    this.disasterGauge = Math.min(100, this.disasterGauge + delta);
    if (this.disasterGauge >= 100) {
      this.logAdd(`灾难累计值已满（${Math.round(this.disasterGauge)}）！岩层开始剧烈坍塌…`, "warn");
      this.triggerGaugeDisaster();
    }
  }

  // v6：累计值满触发灾难，护盾/锚点/高级支撑架可抵挡一次并清零
  private triggerGaugeDisaster(): void {
    if (this.disasterGuardLayers > 0) {
      this.disasterGauge = 0;
      this.logAdd("应急锚点撑住了岩层！灾难累计值清零", "good");
      this.applyAccident("severe");
      return;
    }
    const ss = supportStats(this.save.upgrades.support);
    if (!this.megaShieldUsed && ss.megaShield) {
      this.megaShieldUsed = true;
      this.disasterGauge = 0;
      this.logAdd("高级支撑架替你抵挡了灾难！累计值清零", "good");
      this.applyAccident("severe");
      return;
    }
    if (this.shieldActive) {
      this.shieldActive = false;
      this.disasterGauge = 0;
      this.logAdd("应急护盾替你抵挡了灾难！累计值清零", "good");
      this.applyAccident("severe");
      return;
    }
    this.endByDisaster("灾难累计值已满");
  }

  // v6：刷新当前深度的撤离点状态
  private refreshEvac(): void {
    this.evacAvailable = isEvacDepth(this.depth);
    this.evacSpecial = isSpecialEvacDepth(this.depth);
    this.evacCost = evacCost(this.depth);
  }

  // v6：到达撤离点时的补给（每个撤离点只触发一次）
  private applyEvacSupply(): void {
    if (this.evacSuppliedDepth === this.depth) return;
    this.evacSuppliedDepth = this.depth;
    this.power = Math.min(this.maxPower, this.power + 30);
    this.durability = Math.min(this.maxDurability, this.durability + this.maxDurability * 0.15);
    this.audio.play("success");
    this.logAdd(this.evacSpecial
      ? `抵达特殊撤离点 ${this.depth}m！补给生效（电量 +30，耐久 +15%）`
      : `抵达撤离点 ${this.depth}m！补给生效（电量 +30，耐久 +15%）`, "good");
  }

  // v6：从撤离点撤离（普通免费 / 特殊需缴纳现金）
  evacuate(special: boolean): void {
    if (this.phase !== "observe" && this.phase !== "result") return;
    if (!this.evacAvailable) return;
    if (special) {
      if (!this.evacSpecial) return;
      if (this.pocket < this.evacCost) {
        this.logAdd(`特殊撤离需要缴纳 ${fmt(this.evacCost)} 现金`, "bad");
        this.audio.play("warning");
        return;
      }
      this.pocket -= this.evacCost;
    }
    const d = this.ensureDaily();
    d.tasks.task_evac = (d.tasks.task_evac ?? 0) + 1;
    this.finishRun({ evac: special ? "special" : "normal" });
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
    if (this.disasterGuardLayers > 0) {
      this.audio.play("megaShield");
      this.logAdd("应急锚点撑住了岩层！灾难事故降级为严重事故", "good");
      this.applyAccident("severe");
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

  private endByDisaster(reason = "灾难事故"): void {
    let lossMult = this.anomalyDoubleLoss
      ? Math.min(0.95, safetyStats(this.save.upgrades.safety).disasterLoss * 2)
      : safetyStats(this.save.upgrades.safety).disasterLoss;
    // v7：挑战「深渊诅咒」——灾难损失比例翻倍
    if (this.challenge.includes("abyssal_seed")) lossMult = Math.min(0.95, lossMult * 2);
    const lost = this.removeOreValue(lossMult);
    const saved = Math.round(this.loadValue);
    const depthAt = this.depth;
    // 救援带回的矿石入库（剩余背包矿石即"被救回"的部分，锁定单价）
    this.depositBag();
    // 局内购入的装备未能成功撤离，随灾难丢失
    this.runPendingEquipment = [];
    // 随身现金：50% 损失，50% 回归仓库
    const pocketLost = Math.round(this.pocket * 0.5);
    const pocketReturn = Math.round(this.pocket) - pocketLost;
    this.save.cash += pocketReturn;
    // 挑战词缀收益倍率：失败也按救回价值给予一部分现金补偿
    const challengeMult = this.challenge.reduce((m, c) => m * (CHALLENGE_DEFS[c]?.rewardMult ?? 1), 1);
    if (challengeMult > 1) this.save.cash += Math.round(saved * (challengeMult - 1) * 0.5);
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
      reason,
      lost: Math.round(lost),
      saved,
      depth: depthAt,
      best: wasBest,
      pocketLost,
    };
    const snap = this.buildSnapshot();
    this.cb.onUi(snap);
      this.cb.onRunEnd({ kind: "disaster", banked: saved, depth: depthAt, best: false, rating: null, bonus: 0, difficulty: this.difficulty, save: this.save, recovered: this.recoveredRun });
  }

  // 将当前背包中的矿石/消耗品写入仓库：矿石堆锁定开采当刻单价
  private depositBag(): void {
    for (const slot of this.bag) {
      if (slot.kind === "ore" && slot.quality !== undefined) {
        const ck = oreStackKey(slot.id as OreId, slot.quality);
        this.save.codex.minerals[ck] = (this.save.codex.minerals[ck] ?? 0) + slot.count;
        this.save.warehouseStacks.push({
          key: ck,
          count: slot.count,
          unitValue: Math.round(slot.unitValue),
        });
      } else if (slot.kind === "item") {
        this.save.warehouseItems[slot.id] = (this.save.warehouseItems[slot.id] ?? 0) + 1;
      }
    }
    // 合并同 key + 同单价的堆，保持仓库整洁
    const map = new Map<string, OreStack>();
    for (const s of this.save.warehouseStacks) {
      const k = s.key + "@" + s.unitValue;
      const cur = map.get(k);
      if (cur) cur.count += s.count;
      else map.set(k, { ...s });
    }
    this.save.warehouseStacks = [...map.values()];
  }

  private finishRun(opts: { evac?: "normal" | "special" } = {}): void {
    if (this.runEnded) return;
    const evacKind = opts.evac ?? null;
    const challengeMult = this.challenge.reduce((m, c) => m * (CHALLENGE_DEFS[c]?.rewardMult ?? 1), 1);
    const banked = Math.round(this.loadValue);
    const depthAt = this.depth;
    // 背包矿石入库（锁定单价）；消耗品回仓库；局内购入装备成功撤离后入库
    this.depositBag();
    if (this.runPendingEquipment.length) {
      this.save.warehouseEquipment.push(...this.runPendingEquipment);
      this.runPendingEquipment = [];
    }
    const pocketReturn = Math.round(this.pocket);
    this.save.cash += pocketReturn;
    // 评级：深度 × 货值 × 生存完整度（只奖励现金）
    const rating = computeRating(depthAt, banked, this.durability / Math.max(1, this.maxDurability), this.difficulty);
    let bonusCash = rating.bonusCash + Math.round(banked * (challengeMult - 1));
    // v6：撤离点撤离奖励（普通 ×1.25，特殊 ×2.2 + 深度现金）
    if (evacKind === "normal") bonusCash = Math.round(bonusCash * 1.25);
    else if (evacKind === "special") bonusCash = Math.round(bonusCash * 2.2) + Math.round(depthAt * 1.2);
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
    this.logAdd(evacKind ? `已从${evacKind === "special" ? "特殊" : ""}撤离点撤离，共入库 ${fmt(banked)}` : `安全返回地面，共入库 ${fmt(banked)}`, "good");
    this.surfacedInfo = {
      banked,
      depth: depthAt,
      totalBanked: this.save.stats.totalBanked,
      best: wasBest,
      rating: rating.grade,
      bonusCash,
      pocketReturn,
      evac: evacKind,
    };
    const snap = this.buildSnapshot();
    this.cb.onUi(snap);
    this.cb.onRunEnd({ kind: "surfaced", banked, depth: depthAt, best: wasBest, rating: rating.grade, bonus: bonusCash, difficulty: this.difficulty, save: this.save, recovered: this.recoveredRun });
  }

  private maybeDropItem(): { name: string; icon: string } | null {
    if (this.rnd() >= 0.08) return null;
    const ids = Object.keys(CONSUMABLES);
    const id = ids[Math.floor(this.rnd() * ids.length)];
    const def = CONSUMABLES[id];
    if (!def) return null;
    if (this.usedSlots() >= this.slots) {
      this.logAdd("背包已满，掉落的道具散落损失", "warn");
      return null;
    }
    this.bag.push({
      slotId: this.newSlotId(), key: "item:" + id, kind: "item", id, count: 1,
      name: def.name, color: def.color, icon: def.icon, value: 0, unitValue: 0,
    });
    this.logAdd(`拾取道具：${def.name}`, "good");
    return { name: def.name, icon: def.icon };
  }

  // 矿石异变：随机一叠矿石价值 +10%
  private applyOreMutation(): number {
    const ores = this.bag.filter((s) => s.kind === "ore");
    if (ores.length === 0) return 0;
    const slot = ores[Math.floor(this.rnd() * ores.length)];
    slot.unitValue = slot.unitValue * 1.1;
    const newVal = slot.count * slot.unitValue;
    const delta = newVal - slot.value;
    slot.value = newVal;
    this.loadValue = Math.max(0, this.loadValue + delta);
    return delta;
  }

  private rollPenetration(): number {
    const bonus = Math.min(0.08, 0.006 * this.save.upgrades.drill) + this.pierceBuff / 100 + (this.modules.includes("drill_head") ? 0.1 : 0);
    const base = (PENETRATE_BASE[this.drillMode] + bonus) * (1 - this.wearPenalty);
    let layers = 1;
    const cap = PENETRATE_CAP + this.pierceCapBonus;
    while (layers < cap) {
      const p = base * Math.pow(PENETRATE_DECAY, layers - 1);
      if (this.rnd() >= p) break;
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
      sellRatio: Math.min(0.85, blackSellRatio(favor, this.hasBuff("sell_boost")) + this.scavengerSellBoost()),
      buyDiscount: Math.max(0.5, blackBuyDiscount(favor, this.hasBuff("bm_discount") || this.bmDiscountRun > 0) - this.scavengerBuyDiscount()),
      stock: this.bmStock,
      refreshCost: this.bmRefreshCost(),
      repairCost: blackMarketRepairCost(this.maxDurability),
      repairPct: 40,
      favor: this.save.favor,
      tasks,
      orders: this.buildOrdersView(),
      pocket: Math.round(this.pocket),
      slots: this.slots,
      usedSlots: this.usedSlots(),
      bag: this.bag.map((s) => ({ ...s })),
      depth: this.depth,
    };
  }

  // v9：黑市订单 —— 每日 3 单，展示当前可交付订单（交付在仓库完成）
  private buildOrdersView(): BlackMarketView["orders"] {
    const today = dateKey();
    const od = ensureDailyOrders(this.save.orders, today);
    if (od !== this.save.orders) {
      this.save.orders = od;
      persistSave(this.save);
    }
    return od.active.map((id) => {
      const def = ORDERS[id];
      if (!def) return null;
      return {
        id,
        name: def.name,
        icon: def.icon,
        desc: def.desc,
        need: def.need,
        rewardCash: def.reward.cash,
        rewardFavor: def.reward.favor ?? 0,
        done: od.done.includes(id),
      };
    }).filter((x): x is NonNullable<typeof x> => !!x);
  }
  // ---------------- 钻进结算 ----------------

  private resolveDrill(opts: { stopFraction?: number; burst?: number; blast?: boolean; overheated?: boolean } = {}): void {
    if (!this.layer) return;
    const events: string[] = [];
    const mode = this.drillMode;
    const ds = drillStats(this.save.upgrades.drill);
    // v4：超载收益加成（流派/特性/模块）
    const archOverload = this.archetype === "overdriver" ? 0.2 : 0;
    const molten = this.moltenHeart ? 0.15 : 0;
    const overclockMod = this.modules.includes("overclock") ? 0.25 : 0;
    const ventMod = this.modules.includes("vent") ? -0.1 : 0;
    const modeMult = mode === "cautious" ? 0.75 : mode === "standard" ? 1 : 1.7 + ds.overloadGain + archOverload + molten + overclockMod + ventMod;
    const comboDelta = mode === "cautious" ? 0.08 : mode === "standard" ? 0.1 : 0.13;
    const stopFrac = opts.stopFraction ?? 1;
    const burst = opts.burst ?? 1;
    let layers = this.rollPenetration();
    if (opts.blast) layers += 1; // 超载范围爆破
    layers = Math.min(PENETRATE_CAP + this.pierceCapBonus, layers);
    // 收手/过热停机时收益按进度折算
    const fracMult = stopFrac < 1 ? 0.45 + 0.55 * stopFrac : 1;
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
      const yields = rollOreYield(this.depth, l.ores, l.quality, undefined, this.rnd);
      let gained = this.scaleYields(yields, modeMult * fracMult * burst, comboBefore);
      if (double) {
        gained = gained.map((g) => ({ ...g, count: Math.min(this.stackCap, g.count * 2) }));
        this.logAdd("深渊双倍法则：本层收益翻倍！", "good");
      }
      // 淘金网模块 / 二次采收特性：额外矿石
      if (this.modules.includes("dredge")) {
        const extra = rollOreYield(this.depth, l.ores, l.quality, 1 + Math.floor(this.rnd() * 3), this.rnd);
        gained = gained.concat(this.scaleYields(extra, 1, 1));
      }
      if (this.doubleDip) {
        const extra = rollOreYield(this.depth, l.ores, l.quality, 1, this.rnd);
        gained = gained.concat(this.scaleYields(extra, 1, 1));
      }
      const added = this.addOresToBag(gained, events);
      this.resultOres = this.resultOres.concat(this.toBagSlots(added));
      const value = added.reduce((s, a) => s + this.oreUnitValue(a.id, a.quality) * a.count, 0);
      totalValue += value;

      this.combo = Math.min(5, this.combo + comboDelta);

      const powerBase = (5.5 + l.hardness * 1.15) * (mode === "cautious" ? 1.05 : mode === "standard" ? 0.9 : 1.35);
      const heatMult = 1 + this.overheat * 0.003;
      // v7：统一计算单次电量消耗；幻影钻头（超载减耗）与静电线圈（岩浆带减半）合并为一个倍率，只扣一次
      let powerMult = 1;
      if (mode === "overload" && this.ghostBit) powerMult *= 0.35;
      if (this.staticCoil && l.stage === "magma") powerMult *= 0.5;
      this.power = Math.max(0, this.power - powerBase * heatMult * powerMult);

      // 温和难度无设备损耗
      if (DIFFICULTY_DEFS[this.difficulty].wear) {
        const wearRed = Math.max(0.1, 1 - this.wearReduce / 100);
        const durLoss = (4 + l.hardness * 1.4) * (mode === "cautious" ? 0.6 : mode === "standard" ? 0.9 : 1.4)
          * ds.durabilityLossMult * (1 + this.overheat * 0.004) * wearRed;
        this.durability = Math.max(0, this.durability - durLoss);
      }

      // 岩浆带热量
      if (l.stage === "magma") {
        const heatGain = (12 + 8 * l.hazardSeverity) * (mode === "cautious" ? 0.45 : mode === "standard" ? 1 : 1.65) * this.heatGainMult;
        this.overheat = Math.min(100, this.overheat + heatGain);
        if (mode === "cautious") this.overheat = Math.max(0, this.overheat - 8);
        if (this.overheat >= 100) {
          if (DIFFICULTY_DEFS[this.difficulty].wear && !this.modules.includes("coolant")) {
            this.durability = Math.max(0, this.durability - 8);
          }
          events.push("设备过热！耐久持续下降");
        }
      }

      // 毒气：防毒面罩 / 废气转化 / 净化剂
      if (l.hazard === "gas" && this.rnd() < 0.65) {
        if (this.gasImmune || this.gasConvert) {
          if (this.gasConvert && !this.gasImmune) {
            this.power = Math.min(this.maxPower, this.power + 15);
            events.push("废气引擎：毒气转化为电量 +15");
          } else {
            events.push("防毒面罩生效，毒气无效");
          }
        } else {
          const ss = safetyStats(this.save.upgrades.safety);
          const drain = (13 + 8 * l.hazardSeverity) * (1 - ss.gasResist);
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
      const modeRisk = mode === "cautious" ? 0.55 : mode === "standard" ? 1 : 1.65 * this.overloadRiskMult;
      risk *= modeRisk;
      // v7：深渊生存者 —— 异常层按“异常抗性”削减风险（替代原先笼统的 ×0.92）
      if (l.hazard === "anomaly") {
        const resist = Math.min(90, this.anomalyResistRun + this.equipStats.anomalyResist);
        risk *= Math.max(0.1, 1 - resist / 100);
      }

      this.anomalyDoubleLoss = double;
      const severity = this.rollRisk(risk);
      if (this.runEnded) return;
      // v6：超载钻进额外推高灾难累计值
      if (this.disasterMode === "gauge" && mode === "overload") this.addGauge(2.5);
      if (this.runEnded) return;
      if (severity) {
        this.audio.play("warning");
        this.applyAccident(severity);
        if (this.runEnded) return;
        if (severity === "severe" && layers > 1) {
          interrupted = true;
          events.push("严重事故：穿透被打断，撤回一层");
        }
      }

      // 生物事件：诱饵/免疫可自动避免
      if (l.hazard === "creature" && !severity) {
        const avoid = Math.max(this.baitAvoid, this.creatureImmune > 0 ? 100 : 0, this.modules.includes("bait") ? 50 : 0);
        if (this.rnd() * 100 < avoid) {
          events.push("诱饵起效，地底生物绕开了你");
        } else {
          this.hazardSeverity = l.hazardSeverity;
          this.audio.play("creature");
          this.logAdd("一头地底生物挡住了去路……", "warn");
          interruptHazard = true;
          break;
        }
      }

      // 强盗（硬核）：每层 12% 概率，出现在钻完该层之后
      if (this.difficulty === "hardcore" && !severity && this.rnd() < DIFFICULTY_DEFS.hardcore.banditChance) {
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
        this.retreatBlocked = Math.max(0, this.retreatBlocked - 1);
        this.cautiousCooldown = Math.max(0, this.cautiousCooldown - 1);
        this.refreshEvac();
        if (this.evacAvailable) this.applyEvacSupply();
        this.layer = this.genLayer(this.depth, this.currentAccuracy());
        this.milkCount = 0;
      }
    }

    // v4：超载统计（流派解锁）与稳妥模式冷却
    if (mode === "overload") {
      this.overloadUsedThisRun++;
      this.save.stats.overloadDrills++;
    }
    if (mode === "cautious") this.cautiousCooldown = 2; // v8：冷却跨过下一层，防止连续稳妥

    this.unlockCheckpoints();
    const d = this.ensureDaily();
    d.tasks.task_depth = Math.max(d.tasks.task_depth ?? 0, this.depth);
    this.milkCount = 0;
    this.supportsUsedThisLayer = false;
    this.detectorDisabled = false;
    this.anomalyDouble = false;
    this.anomalyDoubleLoss = false;

    // v6：黑市不再固定在检查点层，每层 15% 随机出现（禁黑市挑战除外）
    this.canBlackMarket = !this.challenge.includes("no_blackmarket") && this.rnd() < 0.15;

    // v6：撤离点刷新与补给（到达撤离点恢复部分电量/耐久）
    this.refreshEvac();
    if (this.evacAvailable) this.applyEvacSupply();
    // v6：每层结算后小幅恢复电量，缓解续航压力
    this.power = Math.min(this.maxPower, this.power + 3);

    if (layers > 1) {
      this.floatTexts.push({
        x: this.w / 2, y: this.rockFaceY() - 60,
        text: `穿透 ×${layers}!`, color: "#ffc857", life: 1.3, maxLife: 1.3, size: 26,
      });
      this.audio.play("success");
    }

    // v6.1：超载钻进任务计数
    if (mode === "overload") {
      const d = this.ensureDaily();
      d.tasks.task_overload = (d.tasks.task_overload ?? 0) + 1;
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
      this.banditSeverity = 1 + Math.floor(this.rnd() * 3);
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
    // v10: page hidden -> auto pause (background rAF ~1Hz would otherwise become 20x slow motion)
    if (this.pageHidden) {
      this.lastTime = t;
      this.raf = requestAnimationFrame(this.loop);
      return;
    }
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

    if (Math.random() < dt * 8 * this.particleMult()) {
      this.particles.push({
        x: Math.random() * this.w, y: this.h + 10,
        vx: (Math.random() - 0.5) * 8, vy: -(10 + Math.random() * 20),
        life: 6 + Math.random() * 4, maxLife: 10, size: 1 + Math.random() * 2,
        color: "rgba(200,180,150,0.35)", type: "dust",
      });
    }
    if (this.layer?.stage === "magma" && Math.random() < dt * 6 * this.particleMult()) {
      this.particles.push({
        x: Math.random() * this.w, y: this.h,
        vx: (Math.random() - 0.5) * 14, vy: -(30 + Math.random() * 40),
        life: 2 + Math.random() * 2, maxLife: 4, size: 1 + Math.random() * 2,
        color: Math.random() < 0.5 ? "rgba(255,120,40,0.8)" : "rgba(255,200,80,0.7)", type: "ember",
      });
    }

    if (this.phase !== "drilling" && this.phase !== "observe" && Math.random() < dt * 6 * this.particleMult()) {
      this.particles.push({
        x: this.w / 2 + (Math.random() - 0.5) * 90, y: this.rockFaceY() + 4,
        vx: (Math.random() - 0.5) * 24, vy: 30 + Math.random() * 50,
        life: 0.6 + Math.random() * 0.6, maxLife: 1.2, size: 1 + Math.random() * 1.6,
        color: "#9c8f7c", type: "debris", grav: 130,
      });
    }
    if (this.rockSwoosh > 0.4 && Math.random() < dt * 40 * this.particleMult()) {
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
      if (Math.random() < dt * 40 * this.particleMult()) {
        this.particles.push({
          x: cx + (Math.random() - 0.5) * 30, y: cy + (Math.random() - 0.5) * 10,
          vx: (Math.random() - 0.5) * 160, vy: (Math.random() - 0.5) * 160,
          life: 0.3 + Math.random() * 0.4, maxLife: 0.7, size: 1 + Math.random() * 2,
          color: Math.random() < 0.6 ? "#ffd166" : "#ff9f43", type: "spark",
        });
      }
      if (Math.random() < dt * 14 * this.particleMult()) {
        this.particles.push({
          x: cx + (Math.random() - 0.5) * 40, y: cy + (Math.random() - 0.5) * 20,
          vx: (Math.random() - 0.5) * 120, vy: 40 + Math.random() * 90,
          life: 0.5 + Math.random() * 0.5, maxLife: 1, size: 2 + Math.random() * 2,
          color: "#9c8f7c", type: "debris", grav: 300,
        });
      }
      this.shake = Math.max(this.shake, 1.2 + (this.drillMode === "overload" ? 2.2 : 0.6));
      // v4：超载模式热量累积（满 100 过载受损停机）
      if (this.drillMode === "overload") {
        const heatRate = (26 + (this.layer?.hazardSeverity ?? 1) * 6) * this.heatGainMult;
        this.drillHeat = Math.min(100, this.drillHeat + dt * heatRate);
        if (this.drillHeat >= 100) {
          this.audio.play("warning");
          this.logAdd("过热！钻机过载受损，被迫停机…", "bad");
          this.durability = Math.max(0, this.durability - 15);
          this.applyAccident("minor");
          if (!this.runEnded) this.resolveDrill({ stopFraction: 0.6, overheated: true });
          return;
        }
      }
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
      // v7：钻进中节流推送 HUD（约 10Hz），让进度/热量/释放按钮实时更新
      this.drillUiAccum += dt;
      if (this.drillUiAccum >= 0.1) {
        this.drillUiAccum = 0;
        this.pushUi();
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


  private canStopDrill(): boolean {
    return this.phase === "drilling" && this.drillMode !== "overload";
  }

  private buildBossView(): BossView | null {
    const b = this.bossState;
    if (!b) return null;
    const desc = b.id === "abyss_lord"
      ? "盘踞在深渊尽头的远古存在，浑身缠绕着深渊之力，寻常钻头难以伤它分毫。"
      : "岩浆带深处的巨兽，熔岩甲壳坚硬如铁，必须寻找破绽才能造成重创。";
    return {
      id: b.id, name: b.name, desc, hp: b.hp, maxHp: b.maxHp,
      canBribe: this.loadValue > 0,
      actions: [
        { id: "drill", label: "正面强攻", desc: "消耗 15 电量、10 耐久，稳定造成 35 点伤害", icon: "⚡" },
        { id: "dodge", label: "伺机闪避", desc: "50% 概率造成 60 点伤害，失败则额外受损", icon: "💨" },
        { id: "bribe", label: "投掷矿石", desc: "损失 10% 矿石价值，造成 70 点伤害", icon: "🪨" },
      ],
    };
  }

  private buildRiskRange(): RiskRange | null {
    const l = this.layer;
    if (!l) return null;
    const base = this.baseRisk();
    const c = Math.min(0.9, base * 0.55);
    const o = Math.min(0.9, base * 1.65 * this.overloadRiskMult);
    const min = Math.round(c * 100);
    const max = Math.round(o * 100);
    const cur = this.drillMode === "cautious" ? c : this.drillMode === "overload" ? o : base;
    const label = riskLabel(cur);
    const color = cur < 0.16 ? "#4ade80" : cur < 0.28 ? "#facc15" : cur < 0.42 ? "#fb923c" : "#f87171";
    return { min, max, label, color };
  }

  private buildEvac(): EvacInfo {
    let lossPct = this.anomalyDoubleLoss
      ? Math.min(0.95, safetyStats(this.save.upgrades.safety).disasterLoss * 2)
      : safetyStats(this.save.upgrades.safety).disasterLoss;
    if (this.challenge.includes("abyssal_seed")) lossPct = Math.min(0.95, lossPct * 2);
    const daily = this.ensureDaily();
    const taskSummary = dailyTasks(daily.date).map((t) => {
      const prog = daily.tasks[t.id] ?? 0;
      return `${t.desc}（${Math.min(prog, t.target)}/${t.target}）`;
    });
    const bagDanger = this.bag.reduce((s, sl) => s + (sl.danger ?? 0), 0);
    return {
      saveNow: Math.round(this.loadValue),
      expectedLossPct: Math.round(lossPct * 100),
      expectedLossValue: Math.round(this.loadValue * lossPct),
      nextMilestone: this.nextMilestone(),
      taskSummary,
      bagDanger: Math.round(bagDanger * 100) / 100,
    };
  }

  private nextMilestone(): { depth: number; name: string } | null {
    const cand: Array<[number, string]> = [];
    for (const cp of [100, 300, 600, 1000]) if (cp > this.depth) cand.push([cp, `升降机检查点 ${cp}m`]);
    for (const b of [500, 950]) if (b > this.depth) cand.push([b, `区域 Boss ${b}m`]);
    const mod = Math.floor(this.depth / 100) * 100 + 50;
    if (mod > this.depth) cand.push([mod, `补给站 ${mod}m`]);
    // v7：始终显示下一个可撤离点（公式生成，1000m 之后也有）
    const ev = Math.floor((this.depth - 50) / 100) * 100 + 150;
    if (ev > this.depth) cand.push([ev, `撤离点 ${ev}m`]);
    if (!cand.length) return null;
    cand.sort((a, b) => a[0] - b[0]);
    return { depth: cand[0][0], name: cand[0][1] };
  }

  private buildNodePreview(l: Layer): Array<{ name: string; riskLabel: string; rewardLabel: string }> {
    if (!this.echoLens && !this.revealQualityAuto && this.save.upgrades.detection < 5) return [];
    const out: Array<{ name: string; riskLabel: string; rewardLabel: string }> = [];
    const rng = mulberry32(l.index * 99991 + 7);
    for (let i = 1; i <= 3; i++) {
      const d = this.depth + i * 10;
      if (d > 2000) break;
      const nl = generateLayer(d, { rng });
      let name = `${d}m`;
      if (d === 500 || d === 950) name = `⚠ Boss ${d}m`;
      else if (d % 30 === 0) name = `分岔路 ${d}m`;
      else if (d % 100 === 50) name = `补给站 ${d}m`;
      else if (CHECKPOINTS.includes(d)) name = `检查点 ${d}m`;
      out.push({ name, riskLabel: riskLabel(nl.collapseRisk), rewardLabel: VEIN_NAME[nl.quality] });
    }
    return out;
  }

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
      disasterGuard: this.disasterGuardLayers,
      disasterMode: this.disasterMode,
      disasterGauge: Math.round(this.disasterGauge),
      detectors: this.detectors,
      slots: this.slots,
      usedSlots: this.usedSlots(),
      bag: this.bag.map((s) => ({ ...s })),
      load: Math.round(this.loadValue),
      pocket: Math.round(this.pocket),
      difficulty: this.difficulty,
      wearPenalty: Math.round(this.wearPenalty * 100) / 100,
      buffs: [...this.buffs],
      archetype: this.archetype,
      challenge: [...this.challenge],
      revealLevel: this.revealLevel,
      routes: this.routeOptions?.map((r) => ({ ...r })) ?? null,
      room: this.roomView ? { ...this.roomView, options: this.roomView.options.map((o) => ({ ...o })) } : null,
      moduleChoice: this.moduleOptions?.map((m) => ({ ...m })) ?? null,
      base: this.baseView ? { ...this.baseView, needOre: this.baseView.needOre ? { ...this.baseView.needOre } : null, options: this.baseView.options.map((o) => ({ ...o })) } : null,
      boss: this.buildBossView(),
      evac: this.buildEvac(),
      evacPoint: this.evacAvailable ? { depth: this.depth, special: this.evacSpecial, cost: this.evacCost } : null,
      riskRange: this.buildRiskRange(),
      cautiousCooldown: this.cautiousCooldown,
      canBlackMarket: this.canBlackMarket,
      blackmarket: this.phase === "blackmarket" ? this.buildBmView() : null,
      layer: l ? {
        signals: l.signals,
        hardnessText: ["松散", "中等", "坚硬", "极硬", "花岗岩"][l.hardness - 1],
        qualityText: VEIN_NAME[l.quality],
        hazardText: l.hazard ? hazardName(l.hazard) : null,
        collapseRiskLabel: riskLabel(l.collapseRisk),
        revealed: this.revealLevel,
        anomalyEffect: l.anomalyEffect,
        milkingAvailable: this.canMilk(),
        milkCount: this.milkCount,
        stage: l.stage,
        nodePreview: this.buildNodePreview(l),
      } : null,
      result: this.phase === "result" || this.phase === "blackmarket" || this.phase === "bandit" ? this.lastResult : null,
      hazard: this.phase === "hazard" ? { type: "creature", severity: this.hazardSeverity } : null,
      anomaly: this.phase === "anomaly" && l?.anomalyEffect ? { text: l.anomalyEffect } : null,
      bandit: this.phase === "bandit" ? { severity: this.banditSeverity, pocket: Math.round(this.pocket) } : null,
      gameover: this.phase === "gameover" ? this.gameoverInfo : null,
      surfaced: this.phase === "surfaced" ? this.surfacedInfo : null,
      retreatBlocked: this.retreatBlocked,
      log: [...this.log],
      drilling: this.phase === "drilling" ? { progress: this.drillProgress, mode: this.drillMode, hardness: l?.hardness ?? 1, heat: this.drillHeat, canStop: this.canStopDrill(), canRelease: this.phase === "drilling" && this.drillMode === "overload" && this.drillHeat > 0 } : null,
      canGuaranteedEvac: this.archetype === "survivor" && !this.evacGuaranteed && !this.evacAvailable && this.combo >= 4 && (this.phase === "observe" || this.phase === "result"),
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
    if (this.shake > 0 && this.shakeEnabled) {
      const shakeAmp = this.shake * (this.reduceMotion ? 0.2 : 1);
      ctx.translate((Math.random() - 0.5) * shakeAmp, (Math.random() - 0.5) * shakeAmp);
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
      ctx.globalAlpha = this.flash * 0.45 * (this.reduceMotion ? 0.3 : 1);
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
    // v7：移动端关闭 Canvas 竖向 HUD，避免与 DOM 面板重叠
    if (w <= 640) return;
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
