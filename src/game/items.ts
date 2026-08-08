// ---------- v2 物品/品质/难度/黑市数据模型 ----------
import { ORES, baseOreValue } from "./config";
import type { OreId } from "./config";

// ================= 矿石品质 =================

export type OreQuality = "poor" | "normal" | "fine" | "legendary";

export const QUALITY_ORDER: OreQuality[] = ["poor", "normal", "fine", "legendary"];

export const ORE_QUALITIES: Record<
  OreQuality,
  { name: string; color: string; mult: number; icon: string }
> = {
  poor:      { name: "劣质",   color: "#8d8577", mult: 0.6, icon: "🪨" },
  normal:    { name: "普通",   color: "#d97b4e", mult: 1.0, icon: "⛏️" },
  fine:      { name: "优良",   color: "#ffd166", mult: 1.8, icon: "✨" },
  legendary: { name: "传奇",   color: "#c77dff", mult: 4.0, icon: "💎" },
};

export function oreStackKey(oreId: OreId, quality: OreQuality): string {
  return oreId + ":" + quality;
}

export function parseOreKey(key: string): { id: OreId; quality: OreQuality } | null {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  const id = key.slice(0, idx) as OreId;
  const quality = key.slice(idx + 1) as OreQuality;
  if (!ORE_QUALITIES[quality]) return null;
  return { id, quality };
}

export function oreMult(oreId: OreId): number {
  return ORES[oreId].mult;
}

// 单个矿石的标准价值（不叠加 mode/combo；mode/combo 通过增加数量来体现）
export function oreUnitValue(depth: number, oreId: OreId, quality: OreQuality): number {
  return baseOreValue(depth) * oreMult(oreId) * ORE_QUALITIES[quality].mult;
}

// ================= 难度 =================

export type Difficulty = "mild" | "normal" | "hardcore";

export const DIFFICULTY_DEFS: Record<
  Difficulty,
  { name: string; icon: string; desc: string; incomeMult: number; wear: boolean; banditChance: number; color: string }
> = {
  mild:     { name: "温和", icon: "🌿", desc: "无设备损耗 · 无强盗 · 收益 ×0.8", incomeMult: 0.8, wear: false, banditChance: 0,    color: "#5fc98f" },
  normal:   { name: "中等", icon: "⚙️", desc: "设备损耗（每 25% 耐久 -10% 性能）· 收益 ×1.0", incomeMult: 1.0, wear: true, banditChance: 0, color: "#ffd166" },
  hardcore: { name: "硬核", icon: "🔥", desc: "设备损耗 + 随机强盗（约 12% 层）· 收益 ×1.5", incomeMult: 1.5, wear: true, banditChance: 0.12, color: "#ff6b5a" },
};

export const DIFFICULTY_ORDER: Difficulty[] = ["mild", "normal", "hardcore"];

// ================= 装备 =================

export type EquipmentSlot = "drill" | "pack" | "armor" | "detector" | "charm";

export const EQUIPMENT_SLOT_NAMES: Record<EquipmentSlot, string> = {
  drill: "钻头",
  pack: "背包",
  armor: "护甲",
  detector: "探测镜",
  charm: "护符",
};

export type EquipmentStats = {
  qualityBonus: number;    // +% 优良/传奇矿石概率
  slotBonus: number;       // + 背包格子
  wearReduce: number;      // -% 耐久损耗
  detectorBonus: number;   // + 探测器次数
  accuracyBonus: number;   // + 探测精度 %
  pierceBonus: number;     // + 穿透概率 %
  banditReduce: number;    // -% 强盗损失
  valueBonus: number;      // +% 矿石价值
  anomalyResist: number;   // +% 深渊异常抗性
};

export const EMPTY_EQUIP_STATS: EquipmentStats = {
  qualityBonus: 0, slotBonus: 0, wearReduce: 0, detectorBonus: 0, accuracyBonus: 0,
  pierceBonus: 0, banditReduce: 0, valueBonus: 0, anomalyResist: 0,
};

export function mergeEquipStats(...list: Array<Partial<EquipmentStats> | undefined>): EquipmentStats {
  const out: EquipmentStats = { ...EMPTY_EQUIP_STATS };
  for (const s of list) if (s) for (const k of Object.keys(EMPTY_EQUIP_STATS) as Array<keyof EquipmentStats>) out[k] += s[k] ?? 0;
  return out;
}

export type ItemTier = 1 | 2 | 3;

export const TIER_NAMES: Record<ItemTier, string> = { 1: "普通", 2: "精良", 3: "极品" };

export type EquipmentInstance = { uid: string; id: string; slot: EquipmentSlot; tier: ItemTier };

// ================= 道具 / 装备定义 =================

export type ItemKind = "consumable" | "equipment";

export type ConsumableEffect = "repair" | "fuel" | "shield" | "purify" | "pierce";

export type ItemDef = {
  id: string;
  name: string;
  icon: string;
  kind: ItemKind;
  desc: string;
  basePrice: number;
  color: string;
  slot?: EquipmentSlot;
  tier?: ItemTier;
  stats?: Partial<EquipmentStats>;
  effect?: ConsumableEffect;
};

export const CONSUMABLES: Record<string, ItemDef> = {
  repair_kit: { id: "repair_kit", name: "维修套件", icon: "🔧", kind: "consumable", desc: "恢复 40% 钻机耐久", basePrice: 60, color: "#e08a45", effect: "repair" },
  fuel_cell:  { id: "fuel_cell",  name: "应急燃料", icon: "⛽", kind: "consumable", desc: "电量 +40", basePrice: 45, color: "#ffd166", effect: "fuel" },
  shield_pot: { id: "shield_pot", name: "应急护盾", icon: "🛡️", kind: "consumable", desc: "抵挡一次灾难", basePrice: 80, color: "#5fc98f", effect: "shield" },
  purifier:   { id: "purifier",   name: "深渊净化剂", icon: "🧪", kind: "consumable", desc: "本局免疫毒气", basePrice: 55, color: "#7cc4ff", effect: "purify" },
  dynamite:   { id: "dynamite",   name: "震波炸药", icon: "💣", kind: "consumable", desc: "本局穿透概率 +8%", basePrice: 70, color: "#ff8c42", effect: "pierce" },
};

const TIER_COLORS: Record<ItemTier, string> = { 1: "#9aa5b1", 2: "#ffd166", 3: "#c77dff" };

function equipDesc(slot: EquipmentSlot, tier: ItemTier, stats: Partial<EquipmentStats>): string {
  const parts: string[] = [];
  if (stats.qualityBonus) parts.push("高品质概率 +" + stats.qualityBonus + "%");
  if (stats.slotBonus) parts.push("背包格 +" + stats.slotBonus);
  if (stats.wearReduce) parts.push("损耗 -" + stats.wearReduce + "%");
  if (stats.detectorBonus) parts.push("探测器 +" + stats.detectorBonus);
  if (stats.accuracyBonus) parts.push("精度 +" + stats.accuracyBonus + "%");
  if (stats.pierceBonus) parts.push("穿透 +" + stats.pierceBonus + "%");
  if (stats.banditReduce) parts.push("强盗损失 -" + stats.banditReduce + "%");
  if (stats.valueBonus) parts.push("矿石价值 +" + stats.valueBonus + "%");
  if (stats.anomalyResist) parts.push("异常抗性 +" + stats.anomalyResist + "%");
  return "[" + TIER_NAMES[tier] + "] " + parts.join(" · ");
}

function equip(
  id: string, name: string, icon: string, slot: EquipmentSlot, tier: ItemTier, stats: Partial<EquipmentStats>, basePrice: number
): ItemDef {
  return { id, name, icon, kind: "equipment", desc: equipDesc(slot, tier, stats), basePrice, color: TIER_COLORS[tier], slot, tier, stats };
}

export const EQUIPMENT_DEFS: Record<string, ItemDef> = {
  // 钻头
  drill_bit_1: equip("drill_bit_1", "钢制钻头", "🔩", "drill", 1, { qualityBonus: 5, valueBonus: 3 }, 220),
  drill_bit_2: equip("drill_bit_2", "合金钻头", "⚙️", "drill", 2, { qualityBonus: 10, valueBonus: 6, pierceBonus: 1 }, 520),
  drill_bit_3: equip("drill_bit_3", "深渊金刚钻", "💠", "drill", 3, { qualityBonus: 18, valueBonus: 12, pierceBonus: 2 }, 1280),
  // 背包
  pack_1: equip("pack_1", "扩容背包", "🎒", "pack", 1, { slotBonus: 2 }, 260),
  pack_2: equip("pack_2", "战术背包", "🧳", "pack", 2, { slotBonus: 4 }, 620),
  pack_3: equip("pack_3", "深渊货仓", "📦", "pack", 3, { slotBonus: 7 }, 1500),
  // 护甲
  armor_1: equip("armor_1", "加固护板", "🛡️", "armor", 1, { wearReduce: 10 }, 240),
  armor_2: equip("armor_2", "复合装甲", "🦺", "armor", 2, { wearReduce: 20 }, 580),
  armor_3: equip("armor_3", "深渊战甲", "🥋", "armor", 3, { wearReduce: 32 }, 1400),
  // 探测镜
  detector_1: equip("detector_1", "声呐探头", "📡", "detector", 1, { detectorBonus: 1, accuracyBonus: 5 }, 230),
  detector_2: equip("detector_2", "穿墙雷达", "🛰️", "detector", 2, { detectorBonus: 1, accuracyBonus: 10 }, 560),
  detector_3: equip("detector_3", "深渊之眼", "👁️", "detector", 3, { detectorBonus: 2, accuracyBonus: 18 }, 1350),
  // 护符
  charm_1: equip("charm_1", "平安符", "🧿", "charm", 1, { banditReduce: 15, anomalyResist: 10 }, 210),
  charm_2: equip("charm_2", "夜枭徽记", "🦉", "charm", 2, { banditReduce: 30, anomalyResist: 20 }, 520),
  charm_3: equip("charm_3", "深渊圣印", "🔯", "charm", 3, { banditReduce: 50, anomalyResist: 35 }, 1300),
};

export const EQUIPMENT_IDS: string[] = Object.keys(EQUIPMENT_DEFS);

export function rollEquipmentTier(): ItemTier {
  const r = Math.random();
  if (r < 0.06) return 3;
  if (r < 0.3) return 2;
  return 1;
}

export function rollEquipmentId(): string {
  return EQUIPMENT_IDS[Math.floor(Math.random() * EQUIPMENT_IDS.length)];
}

export function makeEquipmentInstance(id: string): EquipmentInstance {
  const def = EQUIPMENT_DEFS[id];
  const tier = def.tier ?? rollEquipmentTier();
  return { uid: "eq_" + Math.random().toString(36).slice(2, 10), id, slot: def.slot!, tier };
}

// ================= 一次性增益（开局购买） =================

export type BuffId =
  | "bm_discount" | "sell_boost" | "quality" | "pierce"
  | "wear_less" | "fuel" | "gas" | "shield" | "slots" | "favor";

export type BuffDef = { id: BuffId; name: string; icon: string; desc: string; price: number };

export const BUFF_DEFS: Record<BuffId, BuffDef> = {
  bm_discount: { id: "bm_discount", name: "黑市折扣", icon: "🏷️", desc: "本局黑市现金价格 -30%", price: 80 },
  sell_boost:  { id: "sell_boost",  name: "抬价行情", icon: "📈", desc: "本局黑市售价 +10%", price: 60 },
  quality:     { id: "quality",     name: "寻宝雷达", icon: "🔍", desc: "本局高品质矿石概率 +15%", price: 90 },
  pierce:      { id: "pierce",      name: "穿透增幅", icon: "🌀", desc: "本局穿透概率 +5%", price: 70 },
  wear_less:   { id: "wear_less",   name: "耐磨涂层", icon: "🛢️", desc: "本局设备损耗 -30%", price: 60 },
  fuel:        { id: "fuel",        name: "满油出发", icon: "⛽", desc: "本局电量上限 +40", price: 40 },
  gas:         { id: "gas",         name: "防毒面罩", icon: "😷", desc: "本局免疫毒气", price: 50 },
  shield:      { id: "shield",      name: "一次性护盾", icon: "🛡️", desc: "抵挡一次灾难", price: 80 },
  slots:       { id: "slots",       name: "外挂货架", icon: "🧰", desc: "本局背包格 +2", price: 70 },
  favor:       { id: "favor",       name: "老主顾", icon: "🤝", desc: "本局黑市好感 +1（售价更高）", price: 50 },
};

export const BUFF_ORDER: BuffId[] = [
  "bm_discount", "sell_boost", "quality", "pierce", "wear_less",
  "fuel", "gas", "shield", "slots", "favor",
];

export const BUFF_RANDOM_PRICE = 120;

// ================= 大厅商店（每日刷新） =================

export type ShopStock = { id: string; kind: ItemKind; tier?: ItemTier; price: number };

export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function seededRand(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    return (h % 10000) / 10000;
  };
}

// 每日商店：3-4 件消耗品 + 2 件装备（有一定概率出现极品），价格随"当天种子"稳定
export function generateDailyShop(date: string): ShopStock[] {
  const rnd = seededRand("shop_" + date);
  const stock: ShopStock[] = [];
  const consumableIds = Object.keys(CONSUMABLES);
  const consumableCount = 3 + (rnd() < 0.6 ? 1 : 0);
  const picked = new Set<string>();
  for (let i = 0; i < consumableCount; i++) {
    const id = consumableIds[Math.floor(rnd() * consumableIds.length)];
    if (picked.has(id)) continue;
    picked.add(id);
    stock.push({ id, kind: "consumable", price: CONSUMABLES[id].basePrice });
  }
  const equipIds = [...EQUIPMENT_IDS];
  for (let i = 0; i < 2; i++) {
    const id = equipIds[Math.floor(rnd() * equipIds.length)];
    const def = EQUIPMENT_DEFS[id];
    let tier: ItemTier = def.tier ?? 1;
    const r = rnd();
    if (r < 0.12) tier = 3;
    else if (r < 0.45) tier = 2;
    stock.push({ id, kind: "equipment", tier, price: Math.round(def.basePrice * (tier === 3 ? 3.2 : tier === 2 ? 1.8 : 1)) });
  }
  return stock;
}

// ================= 黑市 =================

export type BmStockItem = {
  id: string;
  name: string;
  icon: string;
  desc: string;
  color: string;
  kind: ItemKind;
  oreCost: { id: OreId; quality: OreQuality; count: number };
  cashPrice: number; // 现金等价（已含好感度折扣/黑市buff）
  payOreValue: number; // 用矿石支付时的总价值
};

// 黑市矿石售价比例：50% 起，好感度每级 +5%，上限 75%（抬价行情 +10%）
export function blackSellRatio(favor: number, buffSell = false): number {
  const base = Math.min(0.75, 0.5 + Math.min(5, Math.max(0, favor)) * 0.05);
  return buffSell ? Math.min(0.85, base + 0.1) : base;
}

// 黑市现金购买折扣：好感度每级 -5%，下限 70%（黑市折扣 -30%）
export function blackBuyDiscount(favor: number, buffDiscount = false): number {
  const base = Math.max(0.7, 1 - Math.min(5, Math.max(0, favor)) * 0.05);
  return buffDiscount ? Math.max(0.5, base - 0.3) : base;
}

export function blackMarketRepairCost(maxDurability: number): number {
  return Math.max(50, Math.round(maxDurability * 0.8));
}

// 黑市货架：从道具/装备池中抽取 4 件；矿石支付数量按"基准价 ×130%"换算
export function generateBmStock(
  depth: number,
  favor: number,
  opts: { sellBoost?: boolean; discount?: boolean } = {}
): BmStockItem[] {
  const sellRatio = blackSellRatio(favor, opts.sellBoost);
  const buyDiscount = blackBuyDiscount(favor, opts.discount);
  const pool: Array<{ def: ItemDef; kind: ItemKind }> = [];
  for (const id of Object.keys(CONSUMABLES)) pool.push({ def: CONSUMABLES[id], kind: "consumable" });
  for (const id of EQUIPMENT_IDS) pool.push({ def: EQUIPMENT_DEFS[id], kind: "equipment" });
  const stock: BmStockItem[] = [];
  const used = new Set<string>();
  while (stock.length < 4 && used.size < pool.length) {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (used.has(pick.def.id)) continue;
    used.add(pick.def.id);
    // 用最常见的可交易矿石作为定价基准
    const oreIds: OreId[] = ["copper", "iron", "silver", "gold"];
    const oreId = oreIds[Math.floor(Math.random() * oreIds.length)];
    const quality: OreQuality = Math.random() < 0.65 ? "normal" : "fine";
    const unit = oreUnitValue(depth, oreId, quality);
    const target = pick.def.basePrice * 1.3;
    const count = Math.max(1, Math.round(target / Math.max(1, unit * sellRatio)));
    const payOreValue = count * unit * sellRatio;
    const cashPrice = Math.max(1, Math.round(payOreValue * buyDiscount));
    stock.push({
      id: pick.def.id,
      name: pick.def.name,
      icon: pick.def.icon,
      desc: pick.def.desc,
      color: pick.def.color,
      kind: pick.def.kind,
      oreCost: { id: oreId, quality, count },
      cashPrice,
      payOreValue: Math.round(payOreValue),
    });
  }
  return stock;
}

// ================= 每日任务（好感度） =================

export type DailyTaskDef = { id: string; desc: string; target: number };

export function dailyTasks(date: string): DailyTaskDef[] {
  const rnd = seededRand("task_" + date);
  const depthTarget = [200, 300, 400, 500][Math.floor(rnd() * 4)];
  const sellTarget = [10, 15, 20][Math.floor(rnd() * 3)];
  const scareTarget = [3, 4, 5][Math.floor(rnd() * 3)];
  return [
    { id: "task_depth", desc: "深潜至 " + depthTarget + "m", target: depthTarget },
    { id: "task_sell", desc: "在黑市出售 " + sellTarget + " 个矿石", target: sellTarget },
    { id: "task_creature", desc: "驱赶 " + scareTarget + " 只地底生物", target: scareTarget },
  ];
}

// ================= 评级 =================

export type Rating = "S" | "A" | "B" | "C";

export const RATING_INFO: Record<Rating, { color: string; bonus: number; name: string }> = {
  S: { color: "#c77dff", bonus: 0.2, name: "传说矿工" },
  A: { color: "#ffd166", bonus: 0.1, name: "资深矿工" },
  B: { color: "#5fc98f", bonus: 0.05, name: "熟练矿工" },
  C: { color: "#9aa5b1", bonus: 0, name: "新晋矿工" },
};

// 评分 = 深度 × 2 + 入库价值 / 10 + 生存完整度 × 800 + 难度加成
export function computeRating(
  depth: number,
  bankedValue: number,
  durabilityRatio: number,
  difficulty: Difficulty
): { grade: Rating; score: number; bonusCash: number } {
  const diffBonus = difficulty === "hardcore" ? 400 : difficulty === "normal" ? 150 : 0;
  const score = depth * 2 + bankedValue / 10 + Math.max(0, durabilityRatio) * 800 + diffBonus;
  let grade: Rating = "C";
  if (score >= 5000) grade = "S";
  else if (score >= 2500) grade = "A";
  else if (score >= 900) grade = "B";
  const bonusCash = Math.round(bankedValue * RATING_INFO[grade].bonus);
  return { grade, score: Math.round(score), bonusCash };
}
