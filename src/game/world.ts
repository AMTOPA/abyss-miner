import { ORES, OreId, StageId, STAGES, baseOreValue, stageForDepth } from "./config";

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

const QUALITY_WEIGHTS: Array<[VeinQuality, number]> = [
  ["legendary", 1],
  ["rich", 3],
  ["normal", 5],
  ["barren", 3],
];

function pickWeighted<T>(entries: Array<[T, number]>): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r <= 0) return v;
  }
  return entries[0][0];
}

function qualityForDepth(depth: number): VeinQuality {
  const deep = depth / 1000;
  const w: Array<[VeinQuality, number]> = [
    ["legendary", Math.min(14, 0.5 + deep * 14)],
    ["rich", Math.min(38, 4 + deep * 30)],
    ["normal", 42 - deep * 8],
    ["barren", Math.max(12, 40 - deep * 30)],
  ];
  return pickWeighted(w);
}

function hardnessForDepth(depth: number): number {
  const base = 1 + (depth / 1000) * 3.2;
  const jitter = (Math.random() - 0.5) * 0.8;
  return Math.max(1, Math.min(5, Math.round(base + jitter)));
}

function instabilityFor(depth: number, quality: VeinQuality): number {
  let v = 0.04 + (depth / 1000) * 0.3;
  if (quality === "rich") v += 0.07;
  if (quality === "legendary") v += 0.14;
  v += (Math.random() - 0.5) * 0.06;
  return Math.max(0.02, Math.min(0.85, v));
}

function orePoolForDepth(depth: number, overload: boolean): OreId[] {
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
    for (let i = 0; i < rares.length && i < 3; i++) pool.push(rares[Math.floor(Math.random() * rares.length)]);
  }
  return pool.length ? pool : ["copper"];
}

function hazardForDepth(depth: number, stage: StageId): { hazard: HazardId | null; severity: number } {
  const r = Math.random();
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

function collapseRiskLabel(risk: number): string {
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

function veinSignal(quality: VeinQuality, noisy: boolean): string {
  const shifted = noisy ? (Math.random() < 0.3 ? shiftQuality(quality) : quality) : quality;
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

function shiftQuality(q: VeinQuality): VeinQuality {
  const order: VeinQuality[] = ["barren", "normal", "rich", "legendary"];
  const i = order.indexOf(q);
  const delta = Math.random() < 0.5 ? -1 : 1;
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

export function generateLayer(depth: number, opts: { overloadHint?: boolean; accuracy?: number } = {}): Layer {
  const index = Math.floor(depth / 10);
  const stage = stageForDepth(depth);
  const quality = qualityForDepth(depth);
  const hardness = hardnessForDepth(depth);
  const instability = instabilityFor(depth, quality);
  const { hazard, severity } = hazardForDepth(depth, stage);
  const ores = orePoolForDepth(depth, opts.overloadHint ?? false);
  const collapseRisk = Math.min(0.9, instability);

  const accuracy = opts.accuracy ?? 0.7;
  const noisy = Math.random() > accuracy;
  const signals: string[] = [];
  signals.push(rockSignal(hardness, quality));
  signals.push(veinSignal(quality, noisy));
  signals.push(dangerSignal(noisy && Math.random() < 0.25 ? Math.min(0.85, instability + 0.15) : instability));
  signals.push(envSignal(stage, hazard));

  let anomalyEffect: string | null = null;
  if (hazard === "anomaly") {
    anomalyEffect = pickAnomalyEffect();
  }

  return {
    index, depth, stage, hardness, quality, instability, hazard, hazardSeverity: severity,
    ores, signals, collapseRisk, revealed: null,
    anomalyEffect,
  };
}

export function pickAnomalyEffect(): string {
  const effects = [
    "探测干扰：本层探测器失灵，无法获取信息",
    "双倍法则：本层收益 ×2，但本轮灾难损失也 ×2",
    "单行道：接下来 2 层内无法撤退",
    "矿石异变：本层结算后背包价值 +10%",
    "深渊回响：下一层信息将完全透明",
    "重力紊乱：本层超载钻进不再增加危险",
  ];
  return effects[Math.floor(Math.random() * effects.length)];
}

export function layerAmount(quality: VeinQuality): number {
  switch (quality) {
    case "barren": return 2 + Math.floor(Math.random() * 2);
    case "normal": return 3 + Math.floor(Math.random() * 3);
    case "rich": return 5 + Math.floor(Math.random() * 4);
    case "legendary": return 7 + Math.floor(Math.random() * 4);
  }
}

export function pickOre(pool: OreId[]): OreId {
  return pool[Math.floor(Math.random() * pool.length)];
}

export type OreYield = { id: OreId; value: number; count?: number };

export function rollOreYield(depth: number, pool: OreId[], quality: VeinQuality, modeMult: number, combo: number, countOverride?: number): OreYield[] {
  const count = countOverride ?? layerAmount(quality);
  const out: OreYield[] = [];
  for (let i = 0; i < count; i++) {
    const id = pickOre(pool);
    const value = baseOreValue(depth) * ORES[id].mult * VEIN_MULT[quality] * modeMult * combo;
    out.push({ id, value });
  }
  return out;
}

export function layerBaseValue(yields: OreYield[]): number {
  return yields.reduce((s, y) => s + y.value, 0);
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
