"use client";

import { useMemo } from "react";
import { OreStack, SaveData, ORES, fmt, persistSave } from "@/game/config";
import { ORDERS } from "@/game/content";
import { CONSUMABLES, ORE_QUALITIES, OreQuality, parseOreKey } from "@/game/items";
import { canDeliverOrder, deliverOrder, ordersNeedingKey, todayOrders } from "@/game/orders";

type Props = {
  save: SaveData;
  onSave: (next: SaveData) => void;
  onGoLoadout?: () => void;   // 跳转到「装备」页签穿戴
};

type OreRow = OreStack & {
  id: string;
  quality: OreQuality;
  total: number; // 该堆总价值（锁定单价 × 数量）
};

export default function WarehousePanel({ save, onSave, onGoLoadout }: Props) {
  // 每堆矿石都锁定开采当刻的单价，价格不随历史最深纪录/市场波动
  const oreRows = useMemo<OreRow[]>(() => {
    const rows: OreRow[] = [];
    for (const s of save.warehouseStacks) {
      if (s.count <= 0) continue;
      const parsed = parseOreKey(s.key);
      if (!parsed) continue;
      rows.push({
        key: s.key, count: s.count, unitValue: s.unitValue,
        id: parsed.id, quality: parsed.quality, total: s.unitValue * s.count,
      });
    }
    rows.sort((a, b) => b.total - a.total);
    return rows;
  }, [save.warehouseStacks]);

  const totalValue = oreRows.reduce((s, r) => s + r.total, 0);
  const itemRows = Object.entries(save.warehouseItems).filter(([, c]) => c > 0);

  // 卖出矿石：按该堆锁定的单价变现，不影响其他堆
  const lockedSet = new Set(save.warehouseLocked);
  const toggleLock = (key: string) => {
    const next = lockedSet.has(key)
      ? save.warehouseLocked.filter((k) => k !== key)
      : [...save.warehouseLocked, key];
    const s: SaveData = { ...save, warehouseLocked: next };
    persistSave(s);
    onSave(s);
  };
  // ??????????????????????
  const sell = (row: OreRow, n: number) => {
    if (lockedSet.has(row.key)) return;
    const sellingAll = n >= row.count;
    const highValue = row.total >= 3000 || row.quality === "legendary";
    if (sellingAll && highValue && typeof window !== "undefined" && !window.confirm(`确认卖出全部 ${row.count} 个（价值 ${fmt(row.total)}）？`)) return;
    const stack = save.warehouseStacks.find((s) => s.key === row.key && s.unitValue === row.unitValue);
    const cur = stack ? stack.count : 0;
    if (cur <= 0) return;
    const sellCount = Math.max(1, Math.min(n, cur));
    const gained = Math.round(row.unitValue * sellCount);
    const nextStacks = save.warehouseStacks
      .map((s) => (s === stack ? { ...s, count: s.count - sellCount } : s))
      .filter((s) => s.count > 0);
    const next: SaveData = {
      ...save,
      cash: save.cash + gained,
      warehouseStacks: nextStacks,
      stats: { ...save.stats, totalSells: save.stats.totalSells + sellCount },
    };
    persistSave(next);
    onSave(next);
  };

  return (
    <div className="deploy-layout">
      <section className="deploy-section">
        <h3 className="deploy-section-title">矿石仓库（单价已锁定，不随深度波动）</h3>
        {oreRows.length === 0 ? (
          <p className="modal-hint">仓库空空如也，下矿把矿石带回来吧！</p>
        ) : (
          <div className="wh-list">
            {oreRows.map((row) => {
              const ore = ORES[row.id as keyof typeof ORES];
              const q = ORE_QUALITIES[row.quality];
              return (
                <div key={row.key + "@" + row.unitValue + "-" + row.count} className={`wh-row${lockedSet.has(row.key) ? " wh-row-locked" : ""}`}>
                  <div className="wh-ore">
                    <span style={{ color: q.color }}>
                      {q.icon} {ore ? ore.name : row.id}·{q.name}
                    </span>
                    <span className="wh-qty">×{row.count}</span>
                  </div>
                  <div className="wh-value">
                    锁定单价 {fmt(row.unitValue)} · 合计 <span className="gold">{fmt(row.total)}</span>
                  </div>
                  <div className="wh-sell">
                    {ordersNeedingKey(save, row.key).length > 0 && (
                      <span className="order-warn" title={`「${ordersNeedingKey(save, row.key).map((o) => o.name).join("、")}」需要这种矿石，交付后更赚`}>
                        📋 订单需要
                      </span>
                    )}
                    <button type="button" className={`btn btn-sm ${lockedSet.has(row.key) ? "btn-gold" : "btn-ghost"}`} onClick={() => toggleLock(row.key)} title={lockedSet.has(row.key) ? "已锁定：不会被卖出，点击解锁" : "锁定：防止误卖"}>{lockedSet.has(row.key) ? "🔒 已锁定" : "🔓 锁定"}</button>
                    <button className="btn btn-secondary btn-sm" disabled={lockedSet.has(row.key)} onClick={() => sell(row, 1)}>卖 1</button>
                    <button className="btn btn-danger btn-sm" disabled={lockedSet.has(row.key)} onClick={() => sell(row, row.count)}>全卖</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="wh-total">
          仓库矿石总价值：<span className="gold">{fmt(totalValue)}</span> 💰
        </div>
      </section>

      <OrderSection save={save} onSave={onSave} />

      <section className="deploy-section">
        <h3 className="deploy-section-title">消耗品</h3>
        {itemRows.length === 0 ? (
          <p className="modal-hint">暂无消耗品，可在商店购买或下矿获取。</p>
        ) : (
          <div className="carry-grid">
            {itemRows.map(([id, count]) => {
              const def = CONSUMABLES[id];
              if (!def) return null;
              return (
                <div key={id} className="carry-chip">
                  <span>{def.icon} {def.name} ×{count}</span>
                  <span className="wh-qty">{def.desc}</span>
                </div>
              );
            })}
          </div>
        )}
        <p className="modal-hint">携带道具请到「出矿」页签选择，最多 4 件，出发时从仓库扣除。</p>
      </section>

      <section className="deploy-section">
        <h3 className="deploy-section-title">装备</h3>
        <div className="wh-total">
          已拥有装备：<span className="cyan">{save.warehouseEquipment.length}</span> 件
        </div>
        {onGoLoadout && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onGoLoadout}>
            🎒 前往装备页签穿戴/管理
          </button>
        )}
      </section>
    </div>
  );
}

// v9：本日订单 —— 消耗仓库矿石交付，结算现金与好感度（每日 3 单，仓库交付）
function OrderSection({ save, onSave }: { save: SaveData; onSave: (next: SaveData) => void }) {
  const od = todayOrders(save);
  const active = od.active.filter((id) => !!ORDERS[id]);
  const haveOre = (key: string): number => save.warehouseStacks.filter((s) => s.key === key).reduce((sum, s) => sum + s.count, 0);

  return (
    <section className="deploy-section">
      <h3 className="deploy-section-title">📋 本日订单（每日刷新，交付消耗仓库矿石）</h3>
      {active.length === 0 ? (
        <p className="modal-hint">今天没有订单，明天再来看看吧。</p>
      ) : (
        <div className="order-list">
          {active.map((id) => {
            const def = ORDERS[id];
            const done = od.done.includes(id);
            const deliverable = canDeliverOrder(save, id);
            const missing: string[] = [];
            for (const need of def.need) {
              const key = need.ore + ":" + need.quality;
              const held = haveOre(key);
              if (held < need.count) missing.push(`${ORES[need.ore as keyof typeof ORES]?.name ?? need.ore}·${ORE_QUALITIES[need.quality as OreQuality]?.name ?? need.quality}（差 ${need.count - held}）`);
            }
            return (
              <div key={id} className={`order-card ${done ? "order-done" : ""}`}>
                <span className="order-icon">{def.icon}</span>
                <span className="order-info">
                  <span className="order-name">{def.name}{done ? <span className="order-done-tag">✅ 已交付</span> : null}</span>
                  <span className="order-desc">{def.desc}</span>
                  <span className="order-need">
                    {def.need.map((need) => {
                      const key = need.ore + ":" + need.quality;
                      const held = haveOre(key);
                      const ok = held >= need.count;
                      return (
                        <span key={key} className={ok ? "order-need-item order-ok" : "order-need-item order-bad"}>
                          "🪨" {need.count} {ORES[need.ore as keyof typeof ORES]?.name ?? need.ore}·{ORE_QUALITIES[need.quality as OreQuality]?.name ?? need.quality}（持有 {held}）
                        </span>
                      );
                    })}
                  </span>
                </span>
                <span className="order-reward">💰 {fmt(def.reward.cash)}{def.reward.favor ? ` + ❤️${def.reward.favor}` : ""}</span>
                {done ? (
                  <span className="order-done-btn">已交付</span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary order-btn"
                    disabled={!deliverable}
                    title={missing.length ? "缺少：" + missing.join("、") : "消耗仓库矿石，领取现金与好感度"}
                    onClick={() => onSave(deliverOrder(save, id))}
                  >
                    交付
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="modal-hint">订单材料被订单锁定：仓库售出时会有提醒，避免误卖。</p>
    </section>
  );
}
