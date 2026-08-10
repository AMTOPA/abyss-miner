"use client";

import { fmt, ORES } from "@/game/config";
import { ORE_QUALITIES, oreStackKey } from "@/game/items";
import type { BlackMarketView } from "@/game/types";

type Props = {
  view: BlackMarketView;
  onSell: (key: string, count: number) => void;   // 出售矿石 -> 随身现金
  onBuy: (index: number, pay: "cash" | "ore") => void; // 购买货架商品
  onRefresh: () => void;                           // 付费刷新货架
  onRepair: () => void;                            // 维修耐久
  onClaim: (taskId: string) => void;               // 领取任务奖励（好感 +1）
  onLeave: () => void;                             // 离开黑市
};

// 黑市面板：出售矿石换随身现金 / 货架双支付购买 / 维修 / 任务板（好感度）
export default function BlackMarketPanel({ view, onSell, onBuy, onRefresh, onRepair, onClaim, onLeave }: Props) {
  const sellRatio = Math.round(view.sellRatio * 100);
  const buyDiscount = Math.round(view.buyDiscount * 100);
  const oreSlots = view.bag.filter((b) => b.kind === "ore");

  // 查看背包里指定矿石堆的数量
  const haveOre = (key: string): number => {
    // v7：汇总所有同 key 堆的数量（同种矿石可能分散在多格）
    return view.bag.filter((b) => b.key === key).reduce((sum, b) => sum + b.count, 0);
  };

  return (
    <div className="run-overlay">
      <div className="panel bm-panel">
        {/* 头部：黑市 / 好感 / 比例 / 随身现金 */}
        <div className="bm-header">
          <span className="bm-title">🕳️ 黑市</span>
          <span className="bm-favor">❤️ 好感 {view.favor}/5</span>
          <span className="bm-favor">出售 {sellRatio}% · 黑市价 {buyDiscount}%</span>
          <span className="pocket-chip">🪙 随身现金 {fmt(view.pocket)}</span>
        </div>

        {/* 出售区：背包矿石 -> 随身现金（折价） */}
        <div className="bm-section">
          <div className="bm-section-title">
            💼 出售矿石（背包 {view.usedSlots}/{view.slots} 格）
          </div>
          {oreSlots.length === 0 ? (
            <p className="bm-empty">背包里没有矿石</p>
          ) : (
            <div className="bm-sell-list">
              {oreSlots.map((slot) => (
                <div key={slot.slotId} className="bm-sell-row" style={{ borderColor: slot.color }}>
                  <span className="bag-icon">{slot.quality ? ORE_QUALITIES[slot.quality].icon : "🪨"}</span>
                  <span className="bm-sell-name">
                    {slot.name}
                    {slot.quality ? "·" + ORE_QUALITIES[slot.quality].name : ""}
                  </span>
                  <span className="bag-qty">×{slot.count}</span>
                  <span className="bm-sell-price">
                    单价 {fmt(Math.round(slot.unitValue * view.sellRatio))}
                    <span className="bm-sell-total">（共 {fmt(Math.round(slot.value * view.sellRatio))}）</span>
                  </span>
                  <span className="bm-sell-actions">
                    <button className="btn btn-sm btn-secondary" disabled={slot.count < 1} onClick={() => onSell(slot.slotId, 1)}>
                      卖1
                    </button>
                    <button className="btn btn-sm btn-secondary" disabled={slot.count < 1} onClick={() => onSell(slot.slotId, slot.count)}>
                      全卖
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 货架：矿石 / 现金 双支付 */}
        <div className="bm-section">
          <div className="bm-section-title bm-section-title-row">
            <span>🛒 货架（本局固定，离开不刷新）</span>
            <button type="button" className="btn btn-sm btn-secondary" disabled={view.pocket < view.refreshCost} onClick={onRefresh} title="消耗随身现金，重新随机货架">🔄 刷新货架（{fmt(view.refreshCost)} 现金）</button>
          </div>
          <div className="bm-stock">
            {view.stock.map((item, i) => {
              const oreKey = oreStackKey(item.oreCost.id, item.oreCost.quality);
              const have = haveOre(oreKey);
              const oreOk = have >= item.oreCost.count;
              const cashOk = view.pocket >= item.cashPrice;
              return (
                <div key={item.id + "-" + i} className="bm-item">
                  <span className="bm-item-icon" style={{ color: item.color }}>
                    {item.icon}
                  </span>
                  <span className="bm-item-info">
                    <span className="bm-item-name">{item.name}</span>
                    <span className="bm-item-desc">{item.desc}</span>
                  </span>
                  <span className="bm-item-pay">
                    <span className="bm-item-ore">
                      {item.oreCost.count} 个 {ORES[item.oreCost.id].name}
                      {ORE_QUALITIES[item.oreCost.quality].name}
                      <span className={oreOk ? "bm-pay-ok" : "bm-pay-bad"}>(持有 {have})</span>
                    </span>
                    <span className="bm-item-cash">{fmt(item.cashPrice)} 现金</span>
                  </span>
                  <span className="bm-item-actions">
                    <button className="btn btn-sm btn-secondary" disabled={!oreOk} onClick={() => onBuy(i, "ore")}>
                      用矿石买
                    </button>
                    <button className="btn btn-sm btn-primary" disabled={!cashOk} onClick={() => onBuy(i, "cash")}>
                      用现金买
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 维修：恢复耐久 */}
        <div className="bm-section">
          <div className="bm-repair">
            <span className="bm-repair-info">
              🔧 维修 {view.repairPct}% 耐久 · 费用 {fmt(view.repairCost)} 现金
            </span>
            <button className="btn btn-sm btn-secondary" disabled={view.pocket < view.repairCost} onClick={onRepair}>
              维修
            </button>
          </div>
        </div>

        {/* 任务板：完成 -> 领取 -> 好感 +1 */}
        <div className="bm-section">
          <div className="bm-section-title">📋 任务板（奖励：好感 +1）</div>
          <div className="bm-tasks">
            {view.tasks.map((t) => {
              const pctW = Math.min(100, Math.round((t.progress / Math.max(1, t.target)) * 100));
              const done = t.progress >= t.target && !t.claimed;
              return (
                <div key={t.id} className={t.claimed ? "bm-task done" : "bm-task"}>
                  <span className="bm-task-desc">{t.desc}</span>
                  <span className="bm-task-bar">
                    <span className="bm-task-fill" style={{ width: pctW + "%" }} />
                  </span>
                  <span className="bm-task-progress">
                    {t.progress}/{t.target}
                  </span>
                  <span className="bm-task-reward">{t.reward}</span>
                  {t.claimed ? (
                    <span className="bm-task-claimed">已领取</span>
                  ) : done ? (
                    <button className="btn btn-sm btn-primary" onClick={() => onClaim(t.id)}>
                      领取
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* v9：本日订单（只读展示，交付在地面仓库完成） */}
        <div className="bm-section">
          <div className="bm-section-title">📋 本日订单</div>
          {view.orders.length === 0 ? (
            <p className="bm-empty">今天没有订单。</p>
          ) : (
            <div className="order-list bm-orders">
              {view.orders.map((o) => (
                <div key={o.id} className={`order-card ${o.done ? "order-done" : ""}`}>
                  <span className="order-icon">{o.icon}</span>
                  <span className="order-info">
                    <span className="order-name">{o.name}{o.done ? <span className="order-done-tag">✅ 已交付</span> : null}</span>
                    <span className="order-desc">{o.desc}</span>
                    <span className="order-need">
                      {o.need.map((need) => (
                        <span key={need.ore + need.quality} className="order-need-item">
                          "🪨" {need.count} {ORES[need.ore as keyof typeof ORES]?.name ?? need.ore}·{ORE_QUALITIES[need.quality as keyof typeof ORE_QUALITIES]?.name ?? need.quality}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="order-reward">💰 {fmt(o.rewardCash)}{o.rewardFavor ? ` + ❤️${o.rewardFavor}` : ""}</span>
                  <span className="order-bm-hint">{o.done ? "已交付" : "回地面仓库交付"}</span>
                </div>
              ))}
            </div>
          )}
          <p className="bm-empty">订单交付在地面仓库完成（消耗仓库矿石，领取现金与好感）。</p>
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary btn-big" onClick={onLeave}>
            离开黑市
          </button>
        </div>
      </div>
    </div>
  );
}
