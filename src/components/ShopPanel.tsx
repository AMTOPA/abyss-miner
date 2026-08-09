"use client";

import { useEffect } from "react";
import { SaveData, fmt, persistSave } from "@/game/config";
import {
  CONSUMABLES, EQUIPMENT_DEFS, ItemTier,
  ShopStock, TIER_NAMES, dateKey, equipInstanceDesc, generateDailyShop, makeEquipmentInstance, scaleStats,
} from "@/game/items";

type Props = {
  save: SaveData;
  onSave: (next: SaveData) => void;
};

export default function ShopPanel({ save, onSave }: Props) {
  const today = dateKey();

  // 每日刷新：日期不符则重新生成并持久化
  useEffect(() => {
    if (save.shop.date === today) return;
    const next: SaveData = {
      ...save,
      shop: { date: today, stock: generateDailyShop(today) },
    };
    persistSave(next);
    onSave(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save, today]);

  const buy = (stock: ShopStock) => {
    if (save.cash < stock.price) return;
    let warehouseItems = save.warehouseItems;
    let warehouseEquipment = save.warehouseEquipment;
    if (stock.kind === "consumable") {
      // 消耗品入仓库，可叠加
      warehouseItems = { ...save.warehouseItems, [stock.id]: (save.warehouseItems[stock.id] ?? 0) + 1 };
    } else {
      // 装备：按货架 tier 生成带缩放属性的实例
      const def = EQUIPMENT_DEFS[stock.id];
      const tier: ItemTier = stock.tier ?? def.tier ?? 1;
      const inst = makeEquipmentInstance(stock.id, tier);
      warehouseEquipment = [...save.warehouseEquipment, inst];
    }
    const next: SaveData = { ...save, cash: save.cash - stock.price, warehouseItems, warehouseEquipment };
    persistSave(next);
    onSave(next);
  };

  return (
    <div className="deploy-layout">
      <section className="deploy-section">
        <h3 className="deploy-section-title">每日商店</h3>
        <div className="shop-refresh">
          刷新日期：{save.shop.date || "—"} · 仓库现金：<span className="gold">{fmt(save.cash)}</span>
        </div>
        <div className="shop-grid">
          {save.shop.stock.map((stock, i) => {
            if (stock.kind === "consumable") {
              const def = CONSUMABLES[stock.id];
              if (!def) return null;
              const afford = save.cash >= stock.price;
              return (
                <div key={stock.id + "-" + i} className="shop-card">
                  <div className="shop-name">{def.icon} {def.name}</div>
                  <div className="shop-desc">{def.desc}</div>
                  <div className="shop-price">{fmt(stock.price)} 💰</div>
                  <button className="btn btn-primary btn-sm" disabled={!afford} onClick={() => buy(stock)}>
                    {afford ? "购买" : "现金不足"}
                  </button>
                </div>
              );
            }
            const def = EQUIPMENT_DEFS[stock.id];
            const tier: ItemTier = stock.tier ?? def.tier ?? 1;
            const tierCls = tier === 3 ? "shop-tier-3" : tier === 2 ? "shop-tier-2" : "shop-tier-1";
            const afford = save.cash >= stock.price;
            const tmpInst = { uid: "shop", id: stock.id, slot: def.slot!, tier, stats: scaleStats(def.stats ?? {}, tier) };
            return (
              <div key={stock.id + "-" + i} className="shop-card">
                <div className={`shop-name ${tierCls}`}>{def.icon} {def.name}</div>
                <div className="shop-desc">{equipInstanceDesc(tmpInst)}</div>
                <div className="shop-price">{fmt(stock.price)} 💰</div>
                <button className="btn btn-primary btn-sm" disabled={!afford} onClick={() => buy(stock)}>
                  {afford ? "购买" : "现金不足"}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}