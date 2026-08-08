// ---------- 游戏核心类型与配置 ----------

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
  backpack:  { id: "backpack",  name: "背包",     desc: "容量提升 · 超载容忍度提高",                 icon: "🎒", baseCost: 80, maxLevel: 12 },
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
  return {
    capacity: 160 + 25 * level,
    overloadTolerance: 0.1 + 0.02 * level, // 超载多少比例内无额外惩罚
  };
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

// ---------- 存档 ----------

export type SaveData = {
  cash: number;
  upgrades: Record<UpgradeId, number>;
  unlockedCheckpoints: number[];
  stats: {
    runs: number;
    totalBanked: number;
    bestRunValue: number;
    bestDepth: number;
    disasters: number;
  };
  settings: { muted: boolean };
};

export const SAVE_KEY = "abyss_miner_save_v1";

export function defaultSave(): SaveData {
  return {
    cash: 0,
    upgrades: { drill: 0, safety: 0, backpack: 0, detection: 0, support: 0 },
    unlockedCheckpoints: [0],
    stats: { runs: 0, totalBanked: 0, bestRunValue: 0, bestDepth: 0, disasters: 0 },
    settings: { muted: false },
  };
}

export function loadSave(): SaveData {
  if (typeof window === "undefined") return defaultSave();
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw);
    return { ...defaultSave(), ...parsed, upgrades: { ...defaultSave().upgrades, ...(parsed.upgrades ?? {}) } };
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
