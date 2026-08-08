"use client";

import { fmt } from "@/game/config";

type Props = {
  severity: number;     // 强盗凶悍程度 1..3
  pocket: number;       // 当前随身现金
  onChoice: (action: "pay" | "give" | "fight") => void;
};

// 强盗事件（硬核难度）：给现金 / 交矿石 / 反抗
export default function BanditPanel({ severity, pocket, onChoice }: Props) {
  const payAmount = Math.ceil(pocket * 0.1);
  return (
    <div className="run-overlay">
      <div className="panel bandit-panel">
        <div className="panel-title danger-text">🥷 强盗拦路！</div>
        <p className="modal-hint">
          凶悍程度：{"◆".repeat(severity)} · 随身现金 {fmt(pocket)}
        </p>
        <div className="bandit-actions">
          <button className="btn btn-secondary" disabled={pocket <= 0} onClick={() => onChoice("pay")}>
            💰 给现金（10% 随身现金{pocket > 0 ? "，约 " + fmt(payAmount) : ""}）
          </button>
          <button className="btn btn-secondary" onClick={() => onChoice("give")}>
            📦 交矿石（损失部分矿石）
          </button>
          <button className="btn btn-overload" onClick={() => onChoice("fight")}>
            ⚔️ 反抗（高风险，可能被抢更多）
          </button>
        </div>
      </div>
    </div>
  );
}
