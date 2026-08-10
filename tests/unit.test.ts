import { describe, it, expect } from "vitest";
import { defaultSave, isEvacDepth, isSpecialEvacDepth } from "../src/game/config";
import { normalizeSave } from "../src/game/save";
import { CONSUMABLES, makeEquipmentInstance, oreUnitValue, scaleStats } from "../src/game/items";
import { overloadOrePool } from "../src/game/world";

describe("存档迁移与校验（v1/v2 -> v4）", () => {
  it("v2 矿石 record 迁移为锁定单价的堆", () => {
    const save = normalizeSave({
      version: 2,
      warehouseOres: { "copper:normal": 20, "silver:fine": 5 },
    });
    expect(save.version).toBe(4);
    expect(save.warehouseStacks.length).toBe(2);
    const copper = save.warehouseStacks.find((s) => s.key === "copper:normal");
    expect(copper?.count).toBe(20);
    expect((copper?.unitValue ?? 0)).toBeGreaterThan(0);
  });

  it("v2 矿石堆单价不随历史最深深度变化", () => {
    const save = normalizeSave({ warehouseOres: { "copper:normal": 20 } });
    const unit1 = save.warehouseStacks[0].unitValue;
    const save2 = normalizeSave({
      warehouseOres: { "copper:normal": 20 },
      stats: { bestDepth: 5000 },
    });
    expect(save2.warehouseStacks[0].unitValue).toBe(unit1);
  });

  it("负现金被钳制为 0，未知字段合并默认值", () => {
    const save = normalizeSave({ cash: -500, upgrades: { drill: 99 } });
    expect(save.cash).toBe(0);
    expect(save.upgrades.drill).toBe(12);
    expect(save.version).toBe(4);
  });

  it("v2 装备（无 stats）迁移时按 tier 补齐缩放属性", () => {
    const save = normalizeSave({
      warehouseEquipment: [{ uid: "eq1", id: "drill_bit_1", slot: "drill", tier: 3 }],
    });
    const inst = save.warehouseEquipment[0];
    // tier 3 倍率 3.2 × 基准 5 = 16
    expect(inst.stats.qualityBonus).toBe(16);
    expect(inst.tier).toBe(3);
  });

  it("defaultSave 结构完整", () => {
    const s = defaultSave();
    expect(s.warehouseStacks).toEqual([]);
    expect(s.version).toBe(4);
    expect(s.settings.reduceMotion).toBe(false);
    expect(s.archetypesUnlocked).toEqual([]);
    expect(s.codex.minerals).toEqual({});
  });
});

describe("装备 tier 缩放", () => {
  it("makeEquipmentInstance 携带缩放后的实际属性", () => {
    const inst = makeEquipmentInstance("drill_bit_1", 3);
    expect(inst.stats.qualityBonus).toBe(16);
    expect(inst.tier).toBe(3);
  });

  it("tier 1 不缩放", () => {
    const inst = makeEquipmentInstance("drill_bit_1", 1);
    expect(inst.stats.qualityBonus).toBe(5);
  });

  it("scaleStats 只保留非零属性", () => {
    const scaled = scaleStats({ qualityBonus: 5, valueBonus: 3 }, 2);
    expect(scaled.qualityBonus).toBe(9);
    expect(scaled.slotBonus).toBeUndefined();
  });
});

describe("矿石估价口径", () => {
  it("同一矿石在同一深度价值稳定", () => {
    expect(oreUnitValue(300, "copper", "normal")).toBe(oreUnitValue(300, "copper", "normal"));
  });

  it("品质倍率单调递增", () => {
    const poor = oreUnitValue(100, "copper", "poor");
    const normal = oreUnitValue(100, "copper", "normal");
    const fine = oreUnitValue(100, "copper", "fine");
    const legend = oreUnitValue(100, "copper", "legendary");
    expect(poor < normal && normal < fine && fine < legend).toBe(true);
  });
});

describe("v7 撤离点公式生成（1000m 后仍可撤离）", () => {
  it("撤离点为 depth % 100 === 50（含 1000m 之后）", () => {
    expect(isEvacDepth(50)).toBe(true);
    expect(isEvacDepth(950)).toBe(true);
    expect(isEvacDepth(1050)).toBe(true);
    expect(isEvacDepth(1150)).toBe(true);
    expect(isEvacDepth(1000)).toBe(false);
    expect(isEvacDepth(0)).toBe(false);
  });

  it("特殊撤离点每 300m 一个（250/550/850/1150…）", () => {
    expect(isSpecialEvacDepth(250)).toBe(true);
    expect(isSpecialEvacDepth(850)).toBe(true);
    expect(isSpecialEvacDepth(1150)).toBe(true);
    expect(isSpecialEvacDepth(1050)).toBe(false);
  });
});

describe("v7 极品装备减免属性钳制（≤90%，防止公式反向）", () => {
  it("wearReduce / banditReduce / anomalyResist 最高 90%", () => {
    const scaled = scaleStats({ wearReduce: 50, banditReduce: 50, anomalyResist: 50, qualityBonus: 5 }, 3);
    expect(scaled.wearReduce).toBe(90);   // 50×3.2=160 -> 90
    expect(scaled.banditReduce).toBe(90);
    expect(scaled.anomalyResist).toBe(90);
    expect(scaled.qualityBonus).toBe(16); // 非减免属性不钳制
  });

  it("深渊战甲实例的 wearReduce 被钳制到 90%", () => {
    const inst = makeEquipmentInstance("armor_3", 3);
    expect(inst.stats.wearReduce).toBe(90);
  });
});

describe("v5 灾难平衡与应急锚点", () => {
  it("应急锚点是可用消耗品，效果为灾难降级（50m 保护）", () => {
    const def = CONSUMABLES["disaster_guard"];
    expect(def).toBeDefined();
    expect(def.effect).toBe("disaster_guard");
    expect(def.basePrice).toBeGreaterThan(0);
    expect(def.desc).toContain("50m");
  });

  it("原有消耗品未受影响", () => {
    expect(CONSUMABLES["shield_pot"].effect).toBe("shield");
    expect(CONSUMABLES["repair_kit_plus"].effect).toBe("repair_plus");
  });
});

describe("超载矿池", () => {
  it("深度足够时包含稀有矿", () => {
    const pool = overloadOrePool(500);
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.some((o) => ["gold", "diamond", "crystal", "unknown"].includes(o))).toBe(true);
  });
});
