import { ORES, OreId, StageId, STAGES, baseOreValue, stageForDepth } from "./config";
import type { OreQuality } from "./items";

// v4：所有随机生成支持注入 rng（本局种子可复现；默认 Math.random）
export type Rng = () => number;

export type VeinQuality = "barren" | "normal" | "rich" | "legendary";

export const VEIN_MULT: Record<VeinQuality, number> = {
  barren: 0.5,
  normal: 1,
  rich: 3,
  legendary: 8,
};

export const VEIN_NAME: Record<VeinQuality, string> = {
  barren: "贫瘠",
  normal: "普通",
  rich: "丰富",
  legendary: "传奇",
};

export type HazardId = "gas" | "heat" | "creature" | "anomaly";

export type Layer = {
  index: number;
  depth: number;
  stage: StageId;
  hardness: number;        // 1..5
  quality: VeinQuality;
  instability: number;     // 0..1
  hazard: HazardId | null;
  hazardSeverity: number;  // 1..3
  ores: OreId[];
  signals: string[];
  // 用于征兆生成的真实信息
  collapseRisk: number;    // 0..1 本层真实塌方风险（不含模式修正）
  revealed: { collapseRisk: number; quality: VeinQuality; hazard: HazardId | null } | null;
  anomalyEffect: string | null;
};

// ---------- v2：层品质决定矿石品质分布 ----------
export const QUALITY_DIST: Record<VeinQuality, Array<[OreQuality, number]>> = {
  barren:    [["poor", 9], ["normal", 1]],
  normal:    [["poor", 2], ["normal", 6], ["fine", 2]],
  rich:      [["normal", 2], ["fine", 7], ["legendary", 1]],
  legendary: [["fine", 6], ["legendary", 4]],
};

const QUALITY_WEIGHTS: Array<[VeinQuality, number]> = [
  ["legendary", 1],
  ["rich", 3],
  ["normal", 5],
  ["barren", 3],
];

function pickWeighted<T>(entries: Array<[T, number]>, rng: Rng): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r <= 0) return v;
  }
  return entries[0][0];
}

export function pickQuality(vein: VeinQuality, rng: Rng = Math.random): OreQuality {
  return pickWeighted(QUALITY_DIST[vein], rng);
}

// 品质提升一档（qualityBonus 触发时使用），传奇封顶
export function upgradeQuality(q: OreQuality): OreQuality {
  const order: OreQuality[] = ["poor", "normal", "fine", "legendary"];
  const i = order.indexOf(q);
  return order[Math.min(order.length - 1, i + 1)];
}

function qualityForDepth(depth: number, rng: Rng): VeinQuality {
  const deep = depth / 1000;
  const w: Array<[VeinQuality, number]> = [
    ["legendary", Math.min(14, 0.5 + deep * 14)],
    ["rich", Math.min(38, 4 + deep * 30)],
    ["normal", 42 - deep * 8],
    ["barren", Math.max(12, 40 - deep * 30)],
  ];
  return pickWeighted(w, rng);
}

function hardnessForDepth(depth: number, rng: Rng): number {
  const base = 1 + (depth / 1000) * 3.2;
  const jitter = (rng() - 0.5) * 0.8;
  return Math.max(1, Math.min(5, Math.round(base + jitter)));
}

function instabilityFor(depth: number, quality: VeinQuality, rng: Rng): number {
  // v5 平衡：深层塌方基数 0.3 -> 0.22（深潜灾难率整体约减半，浅层几乎不变）
  let v = 0.04 + (depth / 1000) * 0.22;
  if (quality === "rich") v += 0.07;
  if (quality === "legendary") v += 0.14;
  v += (rng() - 0.5) * 0.06;
  return Math.max(0.02, Math.min(0.85, v));
}

function orePoolForDepth(depth: number, overload: boolean, rng: Rng): OreId[] {
  const pool: OreId[] = [];
  const add = (id: OreId, w: number) => {
    if (depth >= ORES[id].minDepth) for (let i = 0; i < w; i++) pool.push(id);
  };
  add("stone", 16);
  add("copper", 22);
  add("iron", 20);
  add("silver", 13);
  add("gold", 9);
  add("diamond", 6);
  add("crystal", 4);
  add("unknown", 2);
  // 超载钻进提升稀有矿权重
  if (overload) {
    const rares = pool.filter((o) => ORES[o].weight >= 5);
    for (let i = 0; i < rares.length && i < 3; i++) pool.push(rares[Math.floor(rng() * rares.length)]);
  }
  return pool.length ? pool : ["copper"];
}

// 超载钻进专用矿池：提升稀有矿权重（引擎在选择超载模式时调用）
export function overloadOrePool(depth: number, rng: Rng = Math.random): OreId[] {
  return orePoolForDepth(depth, true, rng);
}

function hazardForDepth(depth: number, stage: StageId, rng: Rng): { hazard: HazardId | null; severity: number } {
  const r = rng();
  if (stage === "shallow") return { hazard: null, severity: 1 };
  if (stage === "oldmine") {
    if (r < 0.22) return { hazard: "gas", severity: r < 0.12 ? 2 : 1 };
    return { hazard: null, severity: 1 };
  }
  if (stage === "magma") {
    if (r < 0.3) return { hazard: "heat", severity: r < 0.14 ? 3 : r < 0.24 ? 2 : 1 };
    return { hazard: null, severity: 1 };
  }
  if (stage === "bio") {
    if (r < 0.32) return { hazard: "creature", severity: r < 0.14 ? 3 : r < 0.24 ? 2 : 1 };
    return { hazard: null, severity: 1 };
  }
  // abyss
  if (r < 0.12) return { hazard: "anomaly", severity: 2 };
  return { hazard: null, severity: 1 };
}

export function collapseRiskLabel(risk: number): string {
  if (risk < 0.08) return "极低";
  if (risk < 0.16) return "低";
  if (risk < 0.28) return "中";
  if (risk < 0.42) return "高";
  return "极高";
}

const HARDNESS_TEXT = ["松散", "中等", "坚硬", "极硬", "花岗岩"];

// ---------- 征兆生成 ----------

function rockSignal(hardness: number, quality: VeinQuality): string {
  const h = HARDNESS_TEXT[hardness - 1];
  if (quality === "rich" || quality === "legendary") return `岩质：${h}，隐约有金属光泽`;
  return `岩质：${h}`;
}

function veinSignal(quality: VeinQuality, noisy: boolean, rng: Rng): string {
  const shifted = noisy ? (rng() < 0.3 ? shiftQuality(quality, rng) : quality) : quality;
  switch (shifted) {
    case "legendary":
      return "探测器传来异常强烈的脉动信号";
    case "rich":
      return "岩壁透出罕见的矿脉色泽";
    case "normal":
      return "探测器出现中等金属反应";
    case "barren":
    default:
      return "探测器仅出现微弱金属反应";
  }
}

function shiftQuality(q: VeinQuality, rng: Rng): VeinQuality {
  const order: VeinQuality[] = ["barren", "normal", "rich", "legendary"];
  const i = order.indexOf(q);
  const delta = rng() < 0.5 ? -1 : 1;
  return order[Math.max(0, Math.min(order.length - 1, i + delta))];
}

function dangerSignal(instability: number): string {
  if (instability > 0.42) return "墙体出现大量新裂纹，碎石不断掉落";
  if (instability > 0.25) return "墙体偶尔掉落碎石";
  if (instability > 0.12) return "岩壁传来微弱的咯吱声";
  return "岩层安静，结构稳固";
}

function envSignal(stage: StageId, hazard: HazardId | null): string {
  switch (hazard) {
    case "gas":
      return "空气带有淡绿色雾气，呼吸感到沉重";
    case "heat":
      return "热浪扑面，岩壁隐隐泛红";
    case "creature":
      return "黑暗中有细小的眼睛在注视你";
    case "anomaly":
      return "这里的物理法则似乎在扭曲……";
    default:
      switch (stage) {
        case "shallow":
          return "空气清新，矿灯照亮了四周";
        case "oldmine":
          return "残留着废弃矿车的锈迹";
        case "magma":
          return "远处传来岩浆的流动声";
        case "bio":
          return "空气中弥漫着孢子与腐殖气息";
        case "abyss":
          return "四周安静得令人不安";
      }
  }
}

export type GenerateLayerOpts = { overloadHint?: boolean; accuracy?: number; rng?: Rng };

export function generateLayer(depth: number, opts: GenerateLayerOpts = {}): Layer {
  const rng = opts.rng ?? Math.random;
  const index = Math.floor(depth / 10);
  const stage = stageForDepth(depth);
  const quality = qualityForDepth(depth, rng);
  const hardness = hardnessForDepth(depth, rng);
  const instability = instabilityFor(depth, quality, rng);
  const { hazard, severity } = hazardForDepth(depth, stage, rng);
  const ores = orePoolForDepth(depth, opts.overloadHint ?? false, rng);
  const collapseRisk = Math.min(0.9, instability);

  const accuracy = opts.accuracy ?? 0.7;
  const noisy = rng() > accuracy;
  const signals: string[] = [];
  signals.push(rockSignal(hardness, quality));
  signals.push(veinSignal(quality, noisy, rng));
  signals.push(dangerSignal(noisy && rng() < 0.25 ? Math.min(0.85, instability + 0.15) : instability));
  signals.push(envSignal(stage, hazard));

  let anomalyEffect: string | null = null;
  if (hazard === "anomaly") {
    anomalyEffect = pickAnomalyEffect(rng);
  }

  return {
    index, depth, stage, hardness, quality, instability, hazard, hazardSeverity: severity,
    ores, signals, collapseRisk, revealed: null,
    anomalyEffect,
  };
}

export function pickAnomalyEffect(rng: Rng = Math.random): string {
  const effects = [
    "探测干扰：本层探测器失灵，无法获取信息",
    "双倍法则：本层收益 ×2，但本轮灾难损失也 ×2",
    "单行道：接下来 2 层内无法撤退",
    "矿石异变：本层结算后背包价值 +10%",
    "深渊回响：下一层信息将完全透明",
    "重力紊乱：本层超载钻进不再增加危险",
  ];
  return effects[Math.floor(rng() * effects.length)];
}

export function layerAmount(quality: VeinQuality, rng: Rng = Math.random): number {
  switch (quality) {
    case "barren": return 2 + Math.floor(rng() * 2);
    case "normal": return 3 + Math.floor(rng() * 3);
    case "rich": return 5 + Math.floor(rng() * 4);
    case "legendary": return 7 + Math.floor(rng() * 4);
  }
}

export function pickOre(pool: OreId[], rng: Rng = Math.random): OreId {
  return pool[Math.floor(rng() * pool.length)];
}

// v2：单矿产出（含品质）。数量倍率（mode/combo/难度/损耗）由引擎按产出聚合。
export type OreYield = { id: OreId; quality: OreQuality };

export function rollOreYield(
  depth: number, pool: OreId[], quality: VeinQuality,
  countOverride?: number, rng: Rng = Math.random
): OreYield[] {
  const count = countOverride ?? layerAmount(quality, rng);
  const out: OreYield[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ id: pickOre(pool, rng), quality: pickQuality(quality, rng) });
  }
  return out;
}

export function hazardName(h: HazardId): string {
  switch (h) {
    case "gas": return "毒气";
    case "heat": return "高温";
    case "creature": return "地底生物";
    case "anomaly": return "深渊异常";
  }
}

export function stageTheme(stage: StageId) {
  return STAGES[stage];
}
