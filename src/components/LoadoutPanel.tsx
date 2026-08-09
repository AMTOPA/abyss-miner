"use client";

import { SaveData, persistSave } from "@/game/config";
import {
  EQUIPMENT_DEFS, EQUIPMENT_SLOT_NAMES, EquipmentInstance, EquipmentSlot,
  EquipmentStats, ItemTier, TIER_NAMES, equipInstanceDesc, mergeEquipStats,
} from "@/game/items";

type Props = {
  save: SaveData;
  onSave: (next: SaveData) => void;
};

const EQUIP_SLOTS: EquipmentSlot[] = ["drill", "pack", "armor", "detector", "charm"];

// 装备加成 -> 文案列表
function statLines(s: EquipmentStats): string[] {
  const out: string[] = [];
  if (s.qualityBonus) out.push("高品质 +" + s.qualityBonus + "%");
  if (s.slotBonus) out.push("背包格 +" + s.slotBonus);
  if (s.wearReduce) out.push("损耗 -" + s.wearReduce + "%");
  if (s.detectorBonus) out.push("探测器 +" + s.detectorBonus);
  if (s.accuracyBonus) out.push("精度 +" + s.accuracyBonus + "%");
  if (s.pierceBonus) out.push("穿透 +" + s.pierceBonus + "%");
  if (s.banditReduce) out.push("强盗损失 -" + s.banditReduce + "%");
  if (s.valueBonus) out.push("价值 +" + s.valueBonus + "%");
  if (s.anomalyResist) out.push("异常抗性 +" + s.anomalyResist + "%");
  return out;
}

// 品质颜色类名
function tierCls(tier: ItemTier): string {
  return tier === 3 ? "shop-tier-3" : tier === 2 ? "shop-tier-2" : "shop-tier-1";
}

export default function LoadoutPanel({ save, onSave }: Props) {
  // 已装备实例
  const equippedList = save.warehouseEquipment.filter((e) => save.equipped[e.slot] === e.uid);
  const merged = mergeEquipStats(...equippedList.map((e) => e.stats));
  const mergedLines = statLines(merged);

  // 装备：写入 save.equipped[slot] = uid（同槽位旧装备自动被覆盖卸下）
  const equip = (inst: EquipmentInstance) => {
    const next: SaveData = { ...save, equipped: { ...save.equipped, [inst.slot]: inst.uid } };
    persistSave(next);
    onSave(next);
  };

  // 卸下
  const unequip = (inst: EquipmentInstance) => {
    if (save.equipped[inst.slot] !== inst.uid) return;
    const equipped = { ...save.equipped };
    delete equipped[inst.slot];
    const next: SaveData = { ...save, equipped };
    persistSave(next);
    onSave(next);
  };

  return (
    <div className="deploy-layout">
      <section className="deploy-section">
        <h3 className="deploy-section-title">当前装备栏</h3>
        {EQUIP_SLOTS.map((slot) => {
          const uid = save.equipped[slot];
          const inst = uid ? save.warehouseEquipment.find((e) => e.uid === uid) : null;
          const def = inst ? EQUIPMENT_DEFS[inst.id] : null;
          return (
            <div key={slot} className="equip-slot-row">
              <span>{EQUIPMENT_SLOT_NAMES[slot]}</span>
              <span>
                {def && inst ? def.icon + " " + def.name + "（" + TIER_NAMES[inst.tier] + "）" : "— 未装备 —"}
              </span>
            </div>
          );
        })}
        <div className="stat-card">
          <span className="stat-label">装备加成合计</span>
          <span className="stat-value cyan">{mergedLines.length ? mergedLines.join(" · ") : "无"}</span>
        </div>
      </section>

      <section className="deploy-section">
        <h3 className="deploy-section-title">装备库（{save.warehouseEquipment.length} 件）</h3>
        {save.warehouseEquipment.length === 0 ? (
          <p className="modal-hint">暂无装备，可在商店购买，或等每日商店刷新出极品。</p>
        ) : (
          <div className="equip-tab-grid">
            {save.warehouseEquipment.map((inst) => {
              const def = EQUIPMENT_DEFS[inst.id];
              const isOn = save.equipped[inst.slot] === inst.uid;
              return (
                <div key={inst.uid} className="equip-card">
                  <div className={`shop-name ${tierCls(inst.tier)}`}>{def.icon} {def.name}</div>
                  <div className="shop-desc">
                    {EQUIPMENT_SLOT_NAMES[inst.slot]} · {equipInstanceDesc(inst)}
                  </div>
                  <div className="equip-btn">
                    {isOn ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => unequip(inst)}>卸下</button>
                    ) : (
                      <button className="btn btn-primary btn-sm" onClick={() => equip(inst)}>装备</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}