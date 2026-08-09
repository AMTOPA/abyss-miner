"use client";

import { useMemo } from "react";
import { OreStack, SaveData, ORES, fmt, persistSave } from "@/game/config";
import { CONSUMABLES, ORE_QUALITIES, OreQuality, parseOreKey } from "@/game/items";

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
  const sell = (row: OreRow, n: number) => {
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
                <div key={row.key + "@" + row.unitValue + "-" + row.count} className="wh-row">
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
                    <button className="btn btn-secondary btn-sm" onClick={() => sell(row, 1)}>卖 1</button>
                    <button className="btn btn-danger btn-sm" onClick={() => sell(row, row.count)}>全卖</button>
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
