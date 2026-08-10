"use client";

import type { BossView } from "@/game/types";

type Props = {
  boss: BossView;
  onAction: (actionId: string) => void;
};

function percent(value: number, max: number): string {
  return `${Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))}%`;
}

// 区域 Boss 面板：所有行动语义由引擎给出的 actionId 决定。
export default function BossPanel({ boss, onAction }: Props) {
  return (
    <div className="panel v4-stage-panel boss-panel boss-card">
      <div className="panel-title stage-panel-heading boss-heading">
        <span className="stage-panel-kicker">区域威胁</span>
        <h2 className="stage-panel-title">👁 {boss.name}</h2>
        <p className="stage-panel-desc">{boss.desc}</p>
      </div>
      <div className="boss-health boss-hp" aria-label={`Boss 生命 ${boss.hp}/${boss.maxHp}`}>
        <div className="boss-health-copy">
          <span>核心完整度</span>
          <strong>{Math.max(0, Math.ceil(boss.hp))} / {Math.max(1, Math.ceil(boss.maxHp))}</strong>
        </div>
        <div className="boss-health-track">
          <span className="boss-health-fill boss-hp-fill" style={{ width: percent(boss.hp, boss.maxHp) }} />
        </div>
      </div>
      <div className="boss-action-list">
        {boss.actions.map((action) => (
          <button key={action.id} type="button" className="boss-action" disabled={action.id === "bribe" && boss.canBribe === false} title={action.id === "bribe" && boss.canBribe === false ? "背包中没有矿石，无法投掷" : undefined} onClick={() => onAction(action.id)}>
            <span className="boss-action-icon">{action.icon}</span>
            <span className="boss-action-copy">
              <span className="boss-action-label">{action.label}</span>
              <span className="boss-action-desc">{action.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
