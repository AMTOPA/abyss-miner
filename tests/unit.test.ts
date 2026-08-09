import { describe, it, expect } from "vitest";
import { defaultSave } from "../src/game/config";
import { normalizeSave } from "../src/game/save";
import { makeEquipmentInstance, oreUnitValue, scaleStats } from "../src/game/items";
import { overloadOrePool } from "../src/game/world";

describe("存档迁移与校验（v1/v2 -> v3）", () => {
  it("v2 矿石 record 迁移为锁定单价的堆", () => {
    const save = normalizeSave({
      version: 2,
      warehouseOres: { "copper:normal": 20, "silver:fine": 5 },
    });
    expect(save.version).toBe(3);
    expect(save.warehouseStacks.length).toBe(2);
    const copper = save.warehouseStacks.find((s) => s.key === "copper:normal");
    expect(copper?.count).toBe(20);
    expect((copper?.unitValue ?? 0)).toBeGreaterThan(0);
  });

  it("v2 矿石堆单价不随历史最深纪录变化", () => {
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
    expect(save.version).toBe(3);
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
    expect(s.version).toBe(3);
    expect(s.settings.reduceMotion).toBe(false);
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

describe("矿石估值口径", () => {
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

describe("超载矿池", () => {
  it("深度足够时包含稀有矿", () => {
    const pool = overloadOrePool(500);
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.some((o) => ["gold", "diamond", "crystal", "unknown"].includes(o))).toBe(true);
  });
});
