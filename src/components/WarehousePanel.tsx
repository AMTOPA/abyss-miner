"use client";

import { useMemo } from "react";
import { SaveData, ORES, OreId, fmt, persistSave } from "@/game/config";
import { CONSUMABLES, ORE_QUALITIES, OreQuality, oreUnitValue, parseOreKey } from "@/game/items";

type Props = {
  save: SaveData;
  onSave: (next: SaveData) => void;
};

type OreRow = {
  key: string; // `${oreId}:${quality}`
  id: OreId;
  quality: OreQuality;
  count: number;
  unit: number;  // 单价
  total: number; // 该堆总价值
};

export default function WarehousePanel({ save, onSave }: Props) {
  // 参考深度：用历史最深，避免空档期价值波动
  const refDepth = save.stats.bestDepth > 0 ? save.stats.bestDepth : 100;

  const oreRows = useMemo<OreRow[]>(() => {
    const rows: OreRow[] = [];
    for (const [key, count] of Object.entries(save.warehouseOres)) {
      const parsed = parseOreKey(key);
      if (!parsed || count <= 0) continue;
      const unit = oreUnitValue(refDepth, parsed.id, parsed.quality);
      rows.push({ key, id: parsed.id, quality: parsed.quality, count, unit, total: unit * count });
    }
    // 按总价值从高到低展示
    rows.sort((a, b) => b.total - a.total);
    return rows;
  }, [save.warehouseOres, refDepth]);

  const totalValue = oreRows.reduce((s, r) => s + r.total, 0);
  const itemRows = Object.entries(save.warehouseItems).filter(([, c]) => c > 0);

  // 卖出矿石：增加现金并移除对应数量
  const sell = (row: OreRow, n: number) => {
    const cur = save.warehouseOres[row.key] ?? 0;
    if (cur <= 0) return;
    const sellCount = Math.max(1, Math.min(n, cur));
    const gained = Math.round(row.unit * sellCount);
    const ores = { ...save.warehouseOres };
    const left = cur - sellCount;
    if (left <= 0) delete ores[row.key];
    else ores[row.key] = left;
    const next: SaveData = {
      ...save,
      cash: save.cash + gained,
      warehouseOres: ores,
      stats: { ...save.stats, totalSells: save.stats.totalSells + sellCount },
    };
    persistSave(next);
    onSave(next);
  };

  return (
    <div className="deploy-layout">
      <section className="deploy-section">
        <h3 className="deploy-section-title">矿石仓库（按 {refDepth}m 深度估值）</h3>
        {oreRows.length === 0 ? (
          <p className="modal-hint">仓库空空如也，下矿把矿石带回来吧！</p>
        ) : (
          <div className="wh-list">
            {oreRows.map((row) => {
              const ore = ORES[row.id];
              const q = ORE_QUALITIES[row.quality];
              return (
                <div key={row.key} className="wh-row">
                  <div className="wh-ore">
                    <span style={{ color: q.color }}>
                      {q.icon} {ore.name}·{q.name}
                    </span>
                    <span className="wh-qty">×{row.count}</span>
                  </div>
                  <div className="wh-value">
                    单价 {fmt(row.unit)} · 合计 <span className="gold">{fmt(row.total)}</span>
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
          已拥有装备：<span className="cyan">{save.warehouseEquipment.length}</span> 件（详情见「装备」页签）
        </div>
      </section>
    </div>
  );
}