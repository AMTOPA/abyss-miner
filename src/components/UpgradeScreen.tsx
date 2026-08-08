"use client";

import { SaveData, UPGRADES, UpgradeId, fmt, persistSave, upgradeCost } from "@/game/config";
import { drillStats, safetyStats, backpackStats, detectionStats, supportStats } from "@/game/config";

type Props = {
  save: SaveData;
  onBuy: (next: SaveData) => void;
  onClose: () => void;
};

function effectText(id: UpgradeId, level: number): string {
  switch (id) {
    case "drill": {
      const s = drillStats(level);
      return `耐久上限 ${s.maxDurability} · 损耗 ×${s.durabilityLossMult.toFixed(2)} · 超载 +${(s.overloadGain * 100).toFixed(0)}%`;
    }
    case "safety": {
      const s = safetyStats(level);
      return `灾难损失 ${Math.round(s.disasterLoss * 100)}% · 紧急撤退 ${Math.round(s.retreatSuccess * 100)}% 成功`;
    }
    case "backpack": {
      const s = backpackStats(level);
      return `容量 ${s.slots} 格`;
    }
    case "detection": {
      const s = detectionStats(level);
      return `探测器 ×${s.detectors} · 精度 ${Math.round(s.accuracy * 100)}%` + (level >= 2 ? " · 可预知下一层" : "");
    }
    case "support": {
      const s = supportStats(level);
      return `支撑架 ×${s.supports} · 塌方 ×${s.effect.toFixed(2)}` + (s.megaShield ? " · 高级防灾难" : "");
    }
  }
}

export default function UpgradeScreen({ save, onBuy, onClose }: Props) {
  const buy = (id: UpgradeId) => {
    const def = UPGRADES[id];
    const lvl = save.upgrades[id];
    if (lvl >= def.maxLevel) return;
    const cost = upgradeCost(def, lvl);
    if (save.cash < cost) return;
    const next: SaveData = {
      ...save,
      cash: save.cash - cost,
      upgrades: { ...save.upgrades, [id]: lvl + 1 },
    };
    persistSave(next);
    onBuy(next);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal panel upgrade-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">🔧 升级车间</h2>
        <p className="modal-hint">
          仓库现金：<span className="gold">{fmt(save.cash)}</span>　·　升级效果永久生效
        </p>
        <div className="upgrade-list">
          {(Object.keys(UPGRADES) as UpgradeId[]).map((id) => {
            const def = UPGRADES[id];
            const lvl = save.upgrades[id];
            const maxed = lvl >= def.maxLevel;
            const cost = maxed ? 0 : upgradeCost(def, lvl);
            const affordable = !maxed && save.cash >= cost;
            return (
              <div key={id} className="upgrade-card">
                <div className="upgrade-icon">{def.icon}</div>
                <div className="upgrade-body">
                  <div className="upgrade-name">{def.name}</div>
                  <div className="upgrade-desc">{def.desc}</div>
                  <div className="upgrade-effect">{effectText(id, lvl)}</div>
                  <div className="upgrade-level">
                    Lv.{lvl} / {def.maxLevel}
                    <span className="level-pips">
                      {Array.from({ length: def.maxLevel }, (_, i) => (
                        <span key={i} className={`pip ${i < lvl ? "on" : ""}`} />
                      ))}
                    </span>
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  disabled={maxed || !affordable}
                  onClick={() => buy(id)}
                >
                  {maxed ? "已满级" : `升级 ${fmt(cost)}`}
                </button>
              </div>
            );
          })}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
