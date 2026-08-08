// ---------- 游戏核心类型与配置 ----------
import type { Difficulty, EquipmentInstance, ShopStock } from "./items";

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
    maxDurability: 100 + 15 * level,
    durabilityLossMult: Math.max(0.55, 1 - 0.035 * level),
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
  // v2：背包升级 = 每级 +1 格子（初始 5 格）；装备/增益可再增加
  return {
    slots: 5 + level,
  };
}

export function backpackUpgradeCost(level: number): number {
  // 升级背包价格较高：160 起步 ×1.6 递增
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
    effect: Math.max(0.12, 0.25 - 0.011 * level), // 塌方风险倍率
    megaShield: level >= 6, // 高级支撑：每轮一次抵挡灾难
  };
}

// ---------- 检查点 ----------

export const CHECKPOINTS = [0, 100, 300, 600, 1000];

export function checkpointCost(depth: number): number {
  return Math.round(depth * 0.6);
}

// ---------- 存档（v2） ----------

export type DailyProgress = { date: string; tasks: Record<string, number>; claimed: Record<string, boolean> };

export type SaveData = {
  version: number;
  cash: number;
  upgrades: Record<UpgradeId, number>;
  unlockedCheckpoints: number[];
  // v2：仓库（撤离的矿石不直接变现，存入仓库）
  warehouseOres: Record<string, number>;       // key `${oreId}:${quality}` -> 数量
  warehouseItems: Record<string, number>;      // 消耗品 itemId -> 数量
  warehouseEquipment: EquipmentInstance[];     // 拥有的装备
  equipped: Partial<Record<"drill" | "pack" | "armor" | "detector" | "charm", string>>; // uid -> 已装备
  shop: { date: string; stock: ShopStock[] };  // 每日刷新商店
  favor: number;                               // 黑市好感 0..5（跨局）
  difficultyUnlocked: Difficulty[];
  daily: DailyProgress;                        // 每日任务进度（好感度来源）
  stats: {
    runs: number;
    totalBanked: number;
    bestRunValue: number;
    bestDepth: number;
    disasters: number;
    totalMined: number;
    totalSells: number;
    creaturesScared: number;
  };
  settings: { muted: boolean };
};

export const SAVE_KEY = "abyss_miner_save_v2";

export function defaultSave(): SaveData {
  return {
    version: 2,
    cash: 0,
    upgrades: { drill: 0, safety: 0, backpack: 0, detection: 0, support: 0 },
    unlockedCheckpoints: [0],
    warehouseOres: {},
    warehouseItems: {},
    warehouseEquipment: [],
    equipped: {},
    shop: { date: "", stock: [] },
    favor: 0,
    difficultyUnlocked: ["mild", "normal"],
    daily: { date: "", tasks: {}, claimed: {} },
    stats: { runs: 0, totalBanked: 0, bestRunValue: 0, bestDepth: 0, disasters: 0, totalMined: 0, totalSells: 0, creaturesScared: 0 },
    settings: { muted: false },
  };
}

export function loadSave(): SaveData {
  if (typeof window === "undefined") return defaultSave();
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    // v1 存档迁移：保留现金/升级/检查点/统计/设置
    if (!raw) {
      const legacy = window.localStorage.getItem("abyss_miner_save_v1");
      if (legacy) {
        const p = JSON.parse(legacy);
        return {
          ...defaultSave(),
          cash: p.cash ?? 0,
          upgrades: { ...defaultSave().upgrades, ...(p.upgrades ?? {}) },
          unlockedCheckpoints: Array.isArray(p.unlockedCheckpoints) ? p.unlockedCheckpoints : [0],
          stats: { ...defaultSave().stats, ...(p.stats ?? {}) },
          settings: { muted: !!p.settings?.muted },
        };
      }
      return defaultSave();
    }
    const parsed = JSON.parse(raw);
    return {
      ...defaultSave(),
      ...parsed,
      upgrades: { ...defaultSave().upgrades, ...(parsed.upgrades ?? {}) },
      unlockedCheckpoints: Array.isArray(parsed.unlockedCheckpoints) ? parsed.unlockedCheckpoints : [0],
      warehouseOres: parsed.warehouseOres ?? {},
      warehouseItems: parsed.warehouseItems ?? {},
      warehouseEquipment: parsed.warehouseEquipment ?? [],
      equipped: parsed.equipped ?? {},
      shop: parsed.shop ?? { date: "", stock: [] },
      daily: parsed.daily ?? { date: "", tasks: {}, claimed: {} },
      difficultyUnlocked: parsed.difficultyUnlocked ?? ["mild", "normal"],
      stats: { ...defaultSave().stats, ...(parsed.stats ?? {}) },
      settings: { muted: !!parsed.settings?.muted },
    };
  } catch {
    return defaultSave();
  }
}

export function persistSave(save: SaveData): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    /* ignore quota errors */
  }
}

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
