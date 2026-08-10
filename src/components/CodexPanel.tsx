"use client";

import { MODULE_POOL, ROOMS, ROOM_ORDER } from "@/game/content";
import { ORES, ORE_ORDER, type SaveData } from "@/game/config";
import { ORE_QUALITIES, QUALITY_ORDER } from "@/game/items";
import {
  RESEARCH_MAX_LEVEL, applyResearch, canResearch, researchBenefitText, researchCost,
  researchLevel, totalResearchLevels, warehouseOreCount as researchWarehouseCount,
} from "@/game/research";

type Props = { save: SaveData; onSave: (next: SaveData) => void };

// 图鉴页同时展示收集进度与尚未发现的条目，便于玩家明确长期目标。
export default function CodexPanel({ save, onSave }: Props) {
  const codex = save.codex ?? {
    minerals: {}, rooms: [], creatures: 0, anomalies: [], modules: [], research: {},
  };
  const discoveredMinerals = Object.values(codex.minerals).filter((count) => count > 0).length;
  const totalMinerals = ORE_ORDER.length * QUALITY_ORDER.length;
  const roomSet = new Set(codex.rooms);
  const moduleSet = new Set(codex.modules);
  const totalResearch = totalResearchLevels(save);
  const accuracyBonus = Math.min(12, totalResearch * 0.4);
  const stackBonus = Math.min(40, totalResearch);

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
            const key = `${oreId}:${qualityId}`;
            const count = codex.minerals[key] ?? 0;
            const level = researchLevel(save, key);
            return (
              <div key={key} className={`codex-mineral-card codex-mineral ${count > 0 ? "discovered" : "locked"}`}>
                {count > 0 && level > 0 && <span className="codex-level-badge">Lv.{level}</span>}
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
          <h3 className="deploy-section-title">🔬 图鉴研究</h3>
          <p className="modal-hint codex-research-summary">
            总研究等级 <strong className="cyan">{totalResearch}</strong> · 探测精度 +{accuracyBonus.toFixed(1)}% · 堆叠上限 +{stackBonus} · 每级提升对应矿物价值 +2%
          </p>
          <div className="research-list">
            {ORE_ORDER.flatMap((oreId) => QUALITY_ORDER.map((qualityId) => {
              const key = `${oreId}:${qualityId}`;
              if ((codex.minerals[key] ?? 0) <= 0) return null;
              const ore = ORES[oreId];
              const quality = ORE_QUALITIES[qualityId];
              const level = researchLevel(save, key);
              const cost = researchCost(key, level);
              const held = researchWarehouseCount(save, key);
              const afford = held >= cost;
              const full = level >= RESEARCH_MAX_LEVEL;
              const why = full ? "已达到最高等级" : (codex.minerals[key] ?? 0) <= 0 ? "尚未发现该矿物" : !afford ? `仓库不足（还需 ${cost - held} 个）` : "";
              return (
                <div key={key} className="research-row">
                  <span className="research-name" style={{ color: quality.color }}>
                    {quality.icon} {ore.name}·{quality.name}
                    <span className="research-level">Lv.{level}/{RESEARCH_MAX_LEVEL}</span>
                  </span>
                  <span className="research-benefit">{researchBenefitText(key, level)}</span>
                  <span className={afford && !full ? "research-cost-ok" : "research-cost-bad"}>
                    消耗 {cost}（持有 {held}）
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary research-btn"
                    disabled={!canResearch(save, key)}
                    title={why || "消耗仓库中的该矿石，永久提升其价值"}
                    onClick={() => onSave(applyResearch(save, key))}
                  >
                    {full ? "已满级" : "研究"}
                  </button>
                </div>
              );
            }))}
            {discoveredMinerals === 0 && <p className="modal-hint">先把矿石带回地面，解锁研究条目。</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
