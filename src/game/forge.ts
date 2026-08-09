// ---------- 锻造 / 制造系统 ----------
// 用仓库矿石 + 现金锻造装备与消耗品（搜打撤式制造台）。
// 消耗品配方复用 content.ts 的 CRAFTING；装备配方为本文件新增。
import type { SaveData } from "./config";
import { ORES, persistSave } from "./config";
import type { EquipmentInstance, EquipmentSlot, ItemTier } from "./items";
import {
  EQUIPMENT_DEFS, EQUIPMENT_IDS, ORE_QUALITIES, makeEquipmentInstance, oreStackKey,
} from "./items";
import { CRAFTING } from "./content";

export type ForgeCost = { ore: string; quality: string; count: number };

export type ForgeRecipe = {
  id: string;
  name: string;
  icon: string;
  desc: string;
  kind: "consumable" | "equipment";
  cost: ForgeCost[];
  cash: number;                 // 额外需要的现金
  resultItem?: string;          // kind=consumable：产出消耗品 id
  resultSlot?: EquipmentSlot;   // kind=equipment：产出装备槽位
  tierRange: [ItemTier, ItemTier]; // 装备品质范围（含端点）
};

// ---------------- 装备锻造配方 ----------------

const equip = (
  id: string, name: string, icon: string, slot: EquipmentSlot,
  tierRange: [ItemTier, ItemTier], cost: ForgeCost[], cash: number, desc: string,
): ForgeRecipe => ({ id, name, icon, kind: "equipment", resultSlot: slot, tierRange, cost, cash, desc });

export const EQUIP_RECIPES: ForgeRecipe[] = [
  // 基础档：普通~精良
  equip("forge_drill_1", "锻制钻头", "🔩", "drill", [1, 2],
    [{ ore: "iron", quality: "normal", count: 6 }, { ore: "copper", quality: "normal", count: 3 }], 60,
    "随机锻制一件钻头（普通~精良）"),
  equip("forge_pack_1", "缝制背包", "🎒", "pack", [1, 2],
    [{ ore: "copper", quality: "normal", count: 5 }, { ore: "silver", quality: "normal", count: 2 }], 60,
    "随机锻制一件背包（普通~精良）"),
  equip("forge_armor_1", "打造护甲", "🛡️", "armor", [1, 2],
    [{ ore: "iron", quality: "normal", count: 6 }, { ore: "gold", quality: "normal", count: 1 }], 65,
    "随机锻制一件护甲（普通~精良）"),
  equip("forge_detector_1", "组装探测器", "📡", "detector", [1, 2],
    [{ ore: "silver", quality: "normal", count: 4 }, { ore: "copper", quality: "normal", count: 4 }], 60,
    "随机锻制一件探测器（普通~精良）"),
  equip("forge_charm_1", "雕琢护符", "🧿", "charm", [1, 2],
    [{ ore: "gold", quality: "normal", count: 2 }, { ore: "silver", quality: "normal", count: 2 }], 70,
    "随机锻制一件护符（普通~精良）"),
  // 精良档：精良~极品
  equip("forge_drill_2", "精炼钻头", "⚙️", "drill", [2, 3],
    [{ ore: "iron", quality: "fine", count: 5 }, { ore: "silver", quality: "fine", count: 2 }], 260,
    "随机锻制一件高品质钻头（精良~极品）"),
  equip("forge_pack_2", "精缝货仓", "🧳", "pack", [2, 3],
    [{ ore: "copper", quality: "fine", count: 5 }, { ore: "silver", quality: "fine", count: 3 }], 260,
    "随机锻制一件高品质背包（精良~极品）"),
  equip("forge_armor_2", "精锻装甲", "🦺", "armor", [2, 3],
    [{ ore: "iron", quality: "fine", count: 5 }, { ore: "gold", quality: "fine", count: 2 }], 280,
    "随机锻制一件高品质护甲（精良~极品）"),
  equip("forge_detector_2", "精装雷达", "🛰️", "detector", [2, 3],
    [{ ore: "silver", quality: "fine", count: 4 }, { ore: "crystal", quality: "normal", count: 2 }], 270,
    "随机锻制一件高品质探测器（精良~极品）"),
  equip("forge_charm_2", "精雕圣印", "🦉", "charm", [2, 3],
    [{ ore: "gold", quality: "fine", count: 3 }, { ore: "crystal", quality: "normal", count: 1 }], 300,
    "随机锻制一件高品质护符（精良~极品）"),
];

// ---------------- 消耗品配方（复用 CRAFTING） ----------------

export const CONSUMABLE_RECIPES: ForgeRecipe[] = Object.entries(CRAFTING).map(([id, r]) => ({
  id,
  name: r.name,
  icon: r.icon,
  desc: "消耗矿石制造一件消耗品",
  kind: "consumable",
  cost: r.cost.map((c) => ({ ore: c.ore, quality: c.quality, count: c.count })),
  cash: 0,
  resultItem: r.result.item,
  tierRange: [1, 1],
}));

export const ALL_RECIPES: ForgeRecipe[] = [...EQUIP_RECIPES, ...CONSUMABLE_RECIPES];

// ---------------- 辅助 ----------------

export function countOre(stacks: SaveData["warehouseStacks"], ore: string, quality: string): number {
  const key = oreStackKey(ore as never, quality as never);
  const s = stacks.find((x) => x.key === key);
  return s ? s.count : 0;
}

export function oreStackKeyStr(ore: string, quality: string): string {
  return ore + ":" + quality;
}

export function oreLabel(ore: string, quality: string): string {
  const oreDef = ORES[ore as keyof typeof ORES];
  const qDef = ORE_QUALITIES[quality as keyof typeof ORE_QUALITIES];
  return (qDef ? qDef.icon + " " : "") + (oreDef ? oreDef.name : ore) + (qDef ? qDef.name : "");
}

// 在品质区间内掷出实际品质（低档 75/25，高档 70/30）
export function rollTier(range: [ItemTier, ItemTier]): ItemTier {
  const [lo, hi] = range;
  if (lo === hi) return lo;
  const r = Math.random();
  if (hi === 3 && lo === 2) return r < 0.7 ? 2 : 3;
  return r < 0.75 ? 1 : 2;
}

// 按槽位 + 品质生成对应 id 的装备实例（tier 1 -> *_1，tier 2 -> *_2 ...）
export function makeEquipmentOfSlotTiered(slot: EquipmentSlot, tier: ItemTier): EquipmentInstance {
  const id = EQUIPMENT_IDS.find((i) => EQUIPMENT_DEFS[i].slot === slot && EQUIPMENT_DEFS[i].tier === tier);
  if (id) return makeEquipmentInstance(id, tier);
  const fallback = EQUIPMENT_IDS.find((i) => EQUIPMENT_DEFS[i].slot === slot);
  return makeEquipmentInstance(fallback ?? EQUIPMENT_IDS[0], tier);
}

export function recipeCostText(r: ForgeRecipe): string {
  const parts = r.cost.map((c) => `${c.count} 个 ${oreLabel(c.ore, c.quality)}`);
  if (r.cash > 0) parts.push(`${r.cash} 现金`);
  return parts.join(" + ");
}

// ---------------- 执行锻造 ----------------

export function canForge(save: SaveData, r: ForgeRecipe): boolean {
  if (save.cash < r.cash) return false;
  for (const c of r.cost) {
    if (countOre(save.warehouseStacks, c.ore, c.quality) < c.count) return false;
  }
  return true;
}

export function forgeRecipe(save: SaveData, r: ForgeRecipe): SaveData | null {
  if (!canForge(save, r)) return null;
  let stacks = save.warehouseStacks.map((s) => ({ ...s }));
  for (const c of r.cost) {
    let need = c.count;
    const key = oreStackKeyStr(c.ore, c.quality);
    stacks = stacks
      .map((s) => {
        if (s.key !== key || need <= 0) return s;
        const take = Math.min(need, s.count);
        need -= take;
        return { ...s, count: s.count - take };
      })
      .filter((s) => s.count > 0);
  }
  const next: SaveData = { ...save, cash: save.cash - r.cash, warehouseStacks: stacks };
  if (r.kind === "consumable" && r.resultItem) {
    next.warehouseItems = { ...save.warehouseItems, [r.resultItem]: (save.warehouseItems[r.resultItem] ?? 0) + 1 };
  } else if (r.resultSlot) {
    const tier = rollTier(r.tierRange);
    const inst = makeEquipmentOfSlotTiered(r.resultSlot, tier);
    next.warehouseEquipment = [...save.warehouseEquipment, inst];
  }
  persistSave(next);
  return next;
}
