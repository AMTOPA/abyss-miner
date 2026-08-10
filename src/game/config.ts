// ---------- 游戏核心类型与配置 ----------
import type { Difficulty, EquipmentInstance, ShopStock } from "./items";
import type { ArchetypeId } from "./types";

export type OreId = "stone" | "copper" | "iron" | "silver" | "gold" | "diamond" | "crystal" | "unknown";

export type OreDef = {
  id: OreId;
  name: string;
  mult: number;
  color: string;
  glow: string;
  minDepth: number;
  weight: number; // 基础权重
};

export const ORES: Record<OreId, OreDef> = {
  stone:    { id: "stone",    name: "石料",     mult: 0.4,  color: "#8d8577", glow: "#b5ab99", minDepth: 0,    weight: 26 },
  copper:   { id: "copper",   name: "铜矿",     mult: 1,    color: "#d97b4e", glow: "#f0a06a", minDepth: 0,    weight: 22 },
  iron:     { id: "iron",     name: "铁矿",     mult: 1.5,  color: "#a0a4a8", glow: "#c8ccd0", minDepth: 20,   weight: 20 },
  silver:   { id: "silver",   name: "银矿",     mult: 3,    color: "#cdd3d8", glow: "#eef0f2", minDepth: 80,   weight: 14 },
  gold:     { id: "gold",     name: "金矿",     mult: 6,    color: "#ffd166", glow: "#ffe9a8", minDepth: 160,  weight: 10 },
  diamond:  { id: "diamond",  name: "钻石",     mult: 15,   color: "#e6f4ef", glow: "#ffffff", minDepth: 300,  weight: 7 },
  crystal:  { id: "crystal",  name: "深渊晶体", mult: 40,   color: "#4be0a8", glow: "#a5ffd8", minDepth: 600,  weight: 4 },
  unknown:  { id: "unknown",  name: "未知矿物", mult: 100,  color: "#c8ff5c", glow: "#eaffb0", minDepth: 1000, weight: 2 },
};

export const ORE_ORDER: OreId[] = ["stone", "copper", "iron", "silver", "gold", "diamond", "crystal", "unknown"];

export type StageId = "shallow" | "oldmine" | "magma" | "bio" | "abyss";

export const STAGES: Record<StageId, {
  name: string; color: string; deepColor: string; accent: string;
}> = {
  shallow: { name: "浅层矿区", color: "#463723", deepColor: "#1b130a", accent: "#d4a65c" },
  oldmine: { name: "旧矿井",   color: "#4a3019", deepColor: "#1c0f06", accent: "#e08a45" },
  magma:   { name: "岩浆带",   color: "#4a1d10", deepColor: "#1c0703", accent: "#ff7a3c" },
  bio:     { name: "生物区",   color: "#22331f", deepColor: "#0a1109", accent: "#5fc98f" },
  abyss:   { name: "深渊",     color: "#1e1a10", deepColor: "#0a0804", accent: "#5fc98f" },
};

export function stageForDepth(depth: number): StageId {
  if (depth < 100) return "shallow";
  if (depth < 300) return "oldmine";
  if (depth < 600) return "magma";
  if (depth < 1000) return "bio";
  return "abyss";
}

export const BASE_ORE_VALUE = 12;

export function baseOreValue(depth: number): number {
  return BASE_ORE_VALUE * Math.pow(1 + depth / 100, 1.35);
}

// ---------- 升级配置 ----------

export type UpgradeId = "drill" | "safety" | "backpack" | "detection" | "support";

export type UpgradeDef = {
  id: UpgradeId;
  name: string;
  desc: string;
  icon: string;
  baseCost: number;
  maxLevel: number;
};

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  drill:     { id: "drill",     name: "钻机",     desc: "耐久上限提升 · 损耗降低 · 超载收益提高", icon: "🔩", baseCost: 70,  maxLevel: 12 },
  safety:    { id: "safety",    name: "安全装备", desc: "灾难损失降低 · 紧急撤退成功率提高",         icon: "🛡️", baseCost: 90, maxLevel: 12 },
  backpack:  { id: "backpack",  name: "背包",     desc: "每级 +1 背包格（升级价格较高）",            icon: "🎒", baseCost: 160, maxLevel: 12 },
  detection: { id: "detection", name: "探测设备", desc: "探测器次数增加 · 信息更精确",               icon: "📡", baseCost: 95, maxLevel: 12 },
  support:   { id: "support",   name: "支撑装备", desc: "支撑架数量增加 · 效果增强",                 icon: "🪨", baseCost: 110, maxLevel: 12 },
};

export function upgradeCost(def: UpgradeDef, level: number): number {
  // 当前等级 -> 升到 level+1 的花费
  return Math.round(def.baseCost * Math.pow(1.55, level));
}

export function drillStats(level: number) {
  return {
    maxDurability: 130 + 18 * level,
    durabilityLossMult: Math.max(0.5, 1 - 0.04 * level),
    overloadGain: 0.02 * level,
  };
}

export function safetyStats(level: number) {
  return {
    disasterLoss: Math.max(0.3, 0.6 - 0.025 * level),
    retreatSuccess: Math.min(0.98, 0.8 + 0.015 * level),
    gasResist: Math.min(0.6, 0.15 + 0.04 * level),
  };
}

export function backpackStats(level: number) {
  return {
    slots: 5 + level,
  };
}

export function backpackUpgradeCost(level: number): number {
  return Math.round(160 * Math.pow(1.6, level));
}

export function detectionStats(level: number) {
  return {
    detectors: Math.min(6, 2 + Math.floor(level / 2)),
    accuracy: Math.min(1, 0.7 + 0.05 * level),
    previewChance: level >= 2 ? Math.min(0.6, 0.15 + 0.05 * level) : 0,
  };
}

export function supportStats(level: number) {
  return {
    supports: Math.min(8, 2 + Math.floor(level / 2)),
    effect: Math.max(0.12, 0.25 - 0.011 * level),
    megaShield: level >= 6,
  };
}

// ---------- 检查点 ----------

export const CHECKPOINTS = [0, 100, 300, 600, 1000];
// ---------- 撤离点（v6：搜打撤） ----------
// 固定撤离点：每 100m 偏移 50m（避开检查点营地 100/300/600/1000）
// ---------- 撤离点（v6：搜打撤） ----------
// 撤离点按公式生成：所有 depth % 100 === 50 的深度（50/150/…/950/1050/1150…），
// 这样任何检查点（含 1000m）之后都能在可预告的下一撤离点安全结算。
export function isEvacDepth(depth: number): boolean {
  return depth > 0 && depth % 100 === 50;
}
// 特殊撤离点（需缴纳随身现金，收益更高）：每 300m 一个（250/550/850/1150…）
export function isSpecialEvacDepth(depth: number): boolean {
  return depth > 0 && depth % 300 === 250;
}
export function evacCost(depth: number): number {
  return Math.round(80 + depth * 0.6);
}

export function checkpointCost(depth: number): number {
  return Math.round(depth * 0.6);
}

// ---------- 存档（v3） ----------

export type DailyProgress = { date: string; tasks: Record<string, number>; claimed: Record<string, boolean> };

// 矿石堆：撤离/救援时锁定开采当刻的单价，之后价格不随深度、纪录或市场变化
export type OreStack = { key: string; count: number; unitValue: number };

export type SaveData = {
  version: number;
  cash: number;
  upgrades: Record<UpgradeId, number>;
  unlockedCheckpoints: number[];
  // v3：矿石堆列表（每个堆锁定 unitValue）
  warehouseStacks: OreStack[];
  warehouseItems: Record<string, number>;      // 消耗品 itemId -> 数量
  warehouseEquipment: EquipmentInstance[];     // 拥有的装备（实例自带 tier 缩放后的属性）
  equipped: Partial<Record<"drill" | "pack" | "armor" | "detector" | "charm", string>>; // uid -> 已装备
  shop: { date: string; stock: ShopStock[] };  // 每日刷新商店
  favor: number;                               // 黑市好感 0..5（跨局）
  difficultyUnlocked: Difficulty[];
  // v4：流派解锁与图鉴
  archetypesUnlocked: ArchetypeId[];
  codex: {
    minerals: Record<string, number>;   // key `${oreId}:${quality}` -> 已收集数量
    rooms: string[];
    creatures: number;
    anomalies: string[];
    modules: string[];
    research: Record<string, number>;   // 图鉴研究等级：key -> level
  };
  daily: DailyProgress;                        // 每日任务进度（好感度来源）
  orders: { date: string; active: string[]; done: string[] }; // v9：黑市订单（每日 3 单，仓库交付）
  stats: {
    runs: number;
    totalBanked: number;
    bestRunValue: number;
    bestDepth: number;
    disasters: number;
    totalMined: number;
    totalSells: number;
    creaturesScared: number;
    bmTrades: number;        // 黑市累计交易次数（拾荒商人解锁）
    anomaliesSeen: number;   // 深渊异常遭遇次数（深渊生存者解锁）
    overloadDrills: number;  // 超载钻进累计次数（超载钻工解锁）
  };
  settings: { muted: boolean; reduceMotion: boolean };
};

export const SAVE_KEY = "abyss_miner_save_v4";
export const SAVE_BACKUP_KEY = "abyss_miner_save_backup_v4";

export function defaultSave(): SaveData {
  return {
    version: 4,
    cash: 0,
    upgrades: { drill: 0, safety: 0, backpack: 0, detection: 0, support: 0 },
    unlockedCheckpoints: [0],
    warehouseStacks: [],
    warehouseItems: {},
    warehouseEquipment: [],
    equipped: {},
    shop: { date: "", stock: [] },
    favor: 0,
    difficultyUnlocked: ["mild", "normal"],
    archetypesUnlocked: [],
    codex: { minerals: {}, rooms: [], creatures: 0, anomalies: [], modules: [], research: {} },
    daily: { date: "", tasks: {}, claimed: {} },
    orders: { date: "", active: [], done: [] },
    stats: { runs: 0, totalBanked: 0, bestRunValue: 0, bestDepth: 0, disasters: 0, totalMined: 0, totalSells: 0, creaturesScared: 0, bmTrades: 0, anomaliesSeen: 0, overloadDrills: 0 },
    settings: { muted: false, reduceMotion: false },
  };
}

// ---------- 存档加载 / 迁移 / 持久化（实现见 save.ts，避免与 items.ts 循环依赖） ----------

export { loadSave, persistSave, normalizeSave, replaceSave, getLocalSaveUpdatedAt, MUTED_KEY } from "./save";

// ---------- 格式化 ----------

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e4) return (n / 1e3).toFixed(1) + "K";
  return Math.round(n).toLocaleString("zh-CN");
}

export function fmtCombo(c: number): string {
  return "×" + c.toFixed(2);
}
