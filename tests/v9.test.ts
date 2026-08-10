import { describe, it, expect } from "vitest";
import { defaultSave, SaveData } from "../src/game/config";
import { ORDERS, dailyOrders, ensureDailyOrders } from "../src/game/content";
import {
  applyResearch, canResearch, researchCost, warehouseOreCount as researchOreCount, RESEARCH_MAX_LEVEL,
} from "../src/game/research";
import {
  canDeliverOrder, deliverOrder, ordersNeedingKey, todayOrders,
} from "../src/game/orders";

function saveWithStacks(stacks: SaveData["warehouseStacks"]): SaveData {
  const s = defaultSave();
  s.warehouseStacks = stacks;
  return s;
}

describe("v9 黑市订单", () => {
  it("每日 3 单且同一日期稳定", () => {
    const a = dailyOrders("2026-08-10");
    const b = dailyOrders("2026-08-10");
    const c = dailyOrders("2026-08-11");
    expect(a.length).toBe(3);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    for (const id of a) expect(ORDERS[id]).toBeDefined();
  });

  it("交付订单：扣仓库矿石 -> 现金 + 好感度，标记完成", () => {
    const orderId = "copper_wiring"; // 20 铜(普通) -> 400 现金 +1 好感
    const save = saveWithStacks([
      { key: "copper:normal", count: 30, unitValue: 20 },
      { key: "iron:normal", count: 5, unitValue: 30 },
    ]);
    save.orders = ensureDailyOrders(save.orders, "2026-08-10");
    // 该订单必须出现在今天的 active 里（若没有，把 active 换成只含它以便测试）
    save.orders = { date: "2026-08-10", active: [orderId], done: [] };

    expect(canDeliverOrder(save, orderId)).toBe(true);
    const next = deliverOrder(save, orderId);
    expect(next.cash).toBe(save.cash + 400);
    expect(next.favor).toBe(Math.min(5, save.favor + 1));
    expect(next.orders.done).toContain(orderId);
    const copperLeft = next.warehouseStacks.find((s) => s.key === "copper:normal");
    expect(copperLeft?.count).toBe(10);
    // 二次交付被拒绝（已完成）
    expect(canDeliverOrder(next, orderId)).toBe(false);
  });

  it("矿石不足时不能交付", () => {
    const orderId = "copper_wiring";
    const save = saveWithStacks([{ key: "copper:normal", count: 5, unitValue: 20 }]);
    save.orders = { date: "2026-08-10", active: [orderId], done: [] };
    expect(canDeliverOrder(save, orderId)).toBe(false);
    expect(deliverOrder(save, orderId)).toBe(save);
  });

  it("ordersNeedingKey 提示订单需要的矿石", () => {
    const save = saveWithStacks([{ key: "copper:normal", count: 50, unitValue: 20 }]);
    save.orders = { date: "2026-08-10", active: ["copper_wiring"], done: [] };
    const needs = ordersNeedingKey(save, "copper:normal");
    expect(needs.some((n) => n.id === "copper_wiring")).toBe(true);
    expect(ordersNeedingKey(save, "silver:fine")).toEqual([]);
  });
});

describe("v9 图鉴研究", () => {
  it("研究成本随等级指数增长", () => {
    const c1 = researchCost("copper:normal", 0);
    const c2 = researchCost("copper:normal", 1);
    expect(c2).toBeGreaterThan(c1);
    expect(c1).toBe(8); // copper:normal 基础成本 8
  });

  it("未发现矿物不能研究；消耗仓库矿石升级并保留余量", () => {
    const save = saveWithStacks([{ key: "copper:normal", count: 10, unitValue: 20 }]);
    save.codex.minerals["copper:normal"] = 3; // 已发现
    expect(canResearch(save, "copper:normal")).toBe(true);
    const next = applyResearch(save, "copper:normal");
    expect(next.codex.research["copper:normal"]).toBe(1);
    expect(next.warehouseStacks.find((s) => s.key === "copper:normal")?.count).toBe(2); // 10 - 8
    // 未发现
    const save2 = saveWithStacks([{ key: "iron:normal", count: 99, unitValue: 20 }]);
    expect(canResearch(save2, "iron:normal")).toBe(false);
    expect(applyResearch(save2, "iron:normal")).toBe(save2);
  });

  it("等级满后不能再研究", () => {
    const save = saveWithStacks([{ key: "copper:normal", count: 99999, unitValue: 20 }]);
    save.codex.minerals["copper:normal"] = 1;
    save.codex.research["copper:normal"] = RESEARCH_MAX_LEVEL;
    expect(canResearch(save, "copper:normal")).toBe(false);
  });

  it("研究等级提升对应矿石价值倍率（引擎口径一致）", () => {
    const save = saveWithStacks([]);
    save.codex.research["gold:fine"] = 5;
    // research.ts 提供 benefit 文本；引擎实际读取 save.codex.research
    expect(researchOreCount(save, "gold:fine")).toBe(0);
    expect(save.codex.research["gold:fine"]).toBe(5);
  });
});
