"use client";

import { MODULE_POOL, ROOMS, ROOM_ORDER } from "@/game/content";
import { ORES, ORE_ORDER, type SaveData } from "@/game/config";
import { ORE_QUALITIES, QUALITY_ORDER } from "@/game/items";

type Props = { save: SaveData };

// 图鉴页同时展示收集进度与尚未发现的条目，便于玩家明确长期目标。
export default function CodexPanel({ save }: Props) {
  const codex = save.codex ?? {
    minerals: {}, rooms: [], creatures: 0, anomalies: [], modules: [], research: {},
  };
  const discoveredMinerals = Object.values(codex.minerals).filter((count) => count > 0).length;
  const totalMinerals = ORE_ORDER.length * QUALITY_ORDER.length;
  const roomSet = new Set(codex.rooms);
  const moduleSet = new Set(codex.modules);
  const researchEntries = Object.entries(codex.research).sort((a, b) => b[1] - a[1]);

  return (
    <div className="codex-panel">
      <div className="codex-summary-grid">
        <div className="stat-card codex-summary-card"><span className="stat-label">矿物条目</span><span className="stat-value gold">{discoveredMinerals}/{totalMinerals}</span></div>
        <div className="stat-card codex-summary-card"><span className="stat-label">特殊房间</span><span className="stat-value cyan">{roomSet.size}/{ROOM_ORDER.length}</span></div>
        <div className="stat-card codex-summary-card"><span className="stat-label">生物遭遇</span><span className="stat-value">{codex.creatures}</span></div>
        <div className="stat-card codex-summary-card"><span className="stat-label">已获模块</span><span className="stat-value purple">{moduleSet.size}/{MODULE_POOL.length}</span></div>
      </div>

      <section className="deploy-section codex-section">
        <h3 className="deploy-section-title">💎 矿物图鉴</h3>
        <div className="codex-mineral-grid codex-grid">
          {ORE_ORDER.flatMap((oreId) => QUALITY_ORDER.map((qualityId) => {
            const ore = ORES[oreId];
            const quality = ORE_QUALITIES[qualityId];
            const count = codex.minerals[`${oreId}:${qualityId}`] ?? 0;
            return (
              <div key={`${oreId}:${qualityId}`} className={`codex-mineral-card codex-mineral ${count > 0 ? "discovered" : "locked"}`}>
                <span className="codex-mineral-icon mineral-icon" style={{ color: ore.color }}>{quality.icon}</span>
                <span className="codex-mineral-name mineral-name">{count > 0 ? ore.name : "未知矿物"}</span>
                <span className="codex-mineral-quality" style={{ color: quality.color }}>{quality.name}</span>
                <span className="codex-mineral-count mineral-meta">已收集 ×{count}</span>
              </div>
            );
          }))}
        </div>
      </section>

      <div className="codex-detail-grid">
        <section className="deploy-section codex-section">
          <h3 className="deploy-section-title">🚪 特殊房间</h3>
          <div className="codex-entry-list">
            {ROOM_ORDER.map((id) => {
              const found = roomSet.has(id);
              const room = ROOMS[id];
              return <div key={id} className={`codex-entry ${found ? "discovered" : "locked"}`}><span>{found ? room.icon : "❔"}</span><span><strong>{found ? room.title : "未发现房间"}</strong><small>{found ? room.desc : "继续深入以记录此地点"}</small></span></div>;
            })}
          </div>
        </section>

        <section className="deploy-section codex-section">
          <h3 className="deploy-section-title">🧩 局内模块</h3>
          <div className="codex-entry-list">
            {MODULE_POOL.map((module) => {
              const found = moduleSet.has(module.id);
              return <div key={module.id} className={`codex-entry ${found ? "discovered" : "locked"}`}><span>{found ? module.icon : "❔"}</span><span><strong>{found ? module.name : "未识别模块"}</strong><small>{found ? module.desc : "在深层节点中选择后记录"}</small></span></div>;
            })}
          </div>
        </section>

        <section className="deploy-section codex-section">
          <h3 className="deploy-section-title">🌀 异常记录</h3>
          {codex.anomalies.length > 0 ? <div className="codex-chip-list">{codex.anomalies.map((id) => <span key={id} className="codex-chip">{id}</span>)}</div> : <p className="modal-hint">尚未记录深渊异常。</p>}
        </section>

        <section className="deploy-section codex-section">
          <h3 className="deploy-section-title">🔬 研究等级</h3>
          {researchEntries.length > 0 ? <div className="codex-research-list">{researchEntries.map(([id, level]) => <div key={id} className="codex-research-row"><span>{id}</span><strong>Lv.{level}</strong></div>)}</div> : <p className="modal-hint">尚未开展图鉴研究。</p>}
        </section>
      </div>
    </div>
  );
}
