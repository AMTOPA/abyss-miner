"use client";

import { useState } from "react";
import { CHECKPOINTS, SaveData, checkpointCost, fmt } from "@/game/config";
import { AuthUser } from "@/lib/api";

type Props = {
  save: SaveData;
  user: AuthUser | null;
  muted: boolean;
  onToggleMute: () => void;
  onStart: (depth: number) => void;
  onUpgrades: () => void;
  onLeaderboard: () => void;
  onLogin: () => void;
  onRegister: () => void;
  onLogout: () => void;
};

export default function HomeScreen(props: Props) {
  const { save, user } = props;
  const [showStart, setShowStart] = useState(false);
  const [selectedDepth, setSelectedDepth] = useState(0);

  const start = () => {
    let cost = 0;
    if (selectedDepth > 0) cost = checkpointCost(selectedDepth);
    if (cost > save.cash) return;
    props.onStart(selectedDepth);
  };

  return (
    <div className="home-screen">
      <div className="home-bg">
        <div className="home-glow g1" />
        <div className="home-glow g2" />
        <div className="home-glow g3" />
        <div className="home-strata" />
        <div className="home-dust d1" />
        <div className="home-dust d2" />
        <div className="home-dust d3" />
        <div className="home-dust d4" />
        <div className="home-dust d5" />
      </div>

      <header className="home-top">
        <div className="home-brand">
          <span className="brand-ore">💎</span>
          <span>深渊矿工</span>
        </div>
        <div className="home-top-right">
          {user ? (
            <div className="user-chip">
              <span className="user-name">{user.username}</span>
              <button className="btn btn-ghost btn-sm" onClick={props.onLogout}>
                退出
              </button>
            </div>
          ) : (
            <div className="user-chip">
              <button className="btn btn-ghost btn-sm" onClick={props.onLogin}>
                登录
              </button>
              <button className="btn btn-primary btn-sm" onClick={props.onRegister}>
                注册
              </button>
            </div>
          )}
          <button className="btn btn-ghost btn-sm" onClick={props.onToggleMute} title={props.muted ? "开启音效" : "静音"}>
            {props.muted ? "🔇" : "🔊"}
          </button>
        </div>
      </header>

      <section className="home-title">
        <h1 className="game-title">
          <span className="title-line">深</span>
          <span className="title-line">渊</span>
          <span className="title-line">矿</span>
          <span className="title-line">工</span>
        </h1>
        <p className="home-subtitle">现在回去，还是再挖一层？</p>
        <p className="home-desc">深入地下 · 赌上背包 · 在灾难降临前带着矿石回到地面</p>
      </section>

      <section className="home-stats">
        <div className="stat-card">
          <span className="stat-label">仓库现金</span>
          <span className="stat-value gold">{fmt(save.cash)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">最深深度</span>
          <span className="stat-value cyan">{save.stats.bestDepth > 0 ? `${save.stats.bestDepth}m` : "—"}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">最佳单次</span>
          <span className="stat-value purple">{fmt(save.stats.bestRunValue)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">总入库</span>
          <span className="stat-value">{fmt(save.stats.totalBanked)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">下矿次数</span>
          <span className="stat-value">{save.stats.runs}</span>
        </div>
      </section>

      <section className="home-menu">
        <button className="btn btn-big btn-primary" onClick={() => setShowStart(true)}>
          ⛏️ 开始下矿
        </button>
        <div className="home-menu-row">
          <button className="btn btn-big btn-secondary" onClick={props.onUpgrades}>
            🔧 升级车间
          </button>
          <button className="btn btn-big btn-secondary" onClick={props.onLeaderboard}>
            🏆 排行榜
          </button>
        </div>
      </section>

      {showStart && (
        <div className="modal-overlay" onClick={() => setShowStart(false)}>
          <div className="modal panel" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">选择出发深度</h2>
            <p className="modal-hint">从检查点出发需要支付费用，且 Combo 从 ×1.00 开始；浅层可慢慢叠 Combo。</p>
            <div className="checkpoint-list">
              {CHECKPOINTS.map((cp) => {
                const unlocked = save.unlockedCheckpoints.includes(cp);
                const cost = cp === 0 ? 0 : checkpointCost(cp);
                const affordable = cost <= save.cash;
                return (
                  <button
                    key={cp}
                    className={`checkpoint-item ${selectedDepth === cp ? "selected" : ""} ${!unlocked ? "locked" : ""}`}
                    disabled={!unlocked}
                    onClick={() => setSelectedDepth(cp)}
                  >
                    <span className="cp-name">{cp === 0 ? "地面 0m" : `${cp}m 检查点`}</span>
                    {unlocked ? (
                      <span className={`cp-cost ${affordable ? "" : "poor"}`}>{cost === 0 ? "免费" : `${fmt(cost)} 现金`}</span>
                    ) : (
                      <span className="cp-cost">未解锁</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowStart(false)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={start}
                disabled={selectedDepth > 0 && checkpointCost(selectedDepth) > save.cash}
              >
                出发！
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
