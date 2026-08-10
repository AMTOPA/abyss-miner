// ---------- v9：黑市订单（纯逻辑，UI 与测试共用） ----------
// 每日 3 单（dailyOrders，按日期种子稳定）；交付消耗仓库矿石，结算现金 + 好感度。
// 黑市只展示订单信息，交付在地面仓库完成（仓库才持有矿石堆）。
import type { SaveData } from "./config";
import { ORDERS, ensureDailyOrders } from "./content";
import { dateKey } from "./items";

export function warehouseOreCount(save: SaveData, key: string): number {
  let total = 0;
  for (const st of save.warehouseStacks) if (st.key === key) total += st.count;
  return total;
}

// 今日订单状态（自动刷新日期）
export function todayOrders(save: SaveData): { date: string; active: string[]; done: string[] } {
  return ensureDailyOrders(save.orders, dateKey());
}

// 是否可交付：订单在本日 active 中、未完成、仓库持有量充足
export function canDeliverOrder(save: SaveData, orderId: string): boolean {
  const def = ORDERS[orderId];
  if (!def) return false;
  const od = todayOrders(save);
  if (!od.active.includes(orderId) || od.done.includes(orderId)) return false;
  for (const need of def.need) {
    const key = need.ore + ":" + need.quality;
    if (warehouseOreCount(save, key) < need.count) return false;
  }
  return true;
}

// 交付订单：扣仓库矿石 -> 现金 + 好感度，标记完成；不满足条件原样返回
export function deliverOrder(save: SaveData, orderId: string): SaveData {
  const def = ORDERS[orderId];
  if (!def || !canDeliverOrder(save, orderId)) return save;
  const od = todayOrders(save);
  const needByKey = new Map<string, number>();
  for (const n of def.need) {
    const key = n.ore + ":" + n.quality;
    needByKey.set(key, (needByKey.get(key) ?? 0) + n.count);
  }
  const remaining = new Map(needByKey);
  const stacks: SaveData["warehouseStacks"] = [];
  for (const st of save.warehouseStacks) {
    const rem = remaining.get(st.key);
    if (rem !== undefined && rem > 0) {
      const take = Math.min(st.count, rem);
      remaining.set(st.key, rem - take);
      if (st.count - take > 0) stacks.push({ ...st, count: st.count - take });
    } else {
      stacks.push(st);
    }
  }
  return {
    ...save,
    cash: save.cash + def.reward.cash,
    favor: Math.min(5, save.favor + (def.reward.favor ?? 0)),
    warehouseStacks: stacks,
    orders: { ...od, done: [...od.done, orderId] },
  };
}

// 该矿石键被哪些本日未完成订单需要（仓库售出时提醒保留）
export function ordersNeedingKey(save: SaveData, key: string): Array<{ id: string; name: string; count: number }> {
  const od = todayOrders(save);
  const out: Array<{ id: string; name: string; count: number }> = [];
  for (const id of od.active) {
    if (od.done.includes(id)) continue;
    const def = ORDERS[id];
    if (!def) continue;
    for (const need of def.need) {
      if (need.ore + ":" + need.quality === key) {
        out.push({ id, name: def.name, count: need.count });
        break;
      }
    }
  }
  return out;
}
