"use client";

import type { ModuleChoice, ModuleId } from "@/game/types";

type Props = {
  modules: ModuleChoice[];
  onChoose: (id: ModuleId) => void;
};

// 局内模块三选一：模块由本局持有，不写入大厅装备栏。
export default function ModulePanel({ modules, onChoose }: Props) {
  return (
    <div className="panel v4-stage-panel module-panel">
      <div className="panel-title stage-panel-heading">
        <span className="stage-panel-kicker">模块接入</span>
        <h2 className="stage-panel-title">选择一个局内模块</h2>
        <p className="stage-panel-desc">只能装载一个，选择后立即生效。</p>
      </div>
      <div className="module-card-grid">
        {modules.map((module) => (
          <button
            key={module.id}
            type="button"
            className="module-card"
            onClick={() => onChoose(module.id)}
          >
            <span className="module-card-icon">{module.icon}</span>
            <span className="module-card-name module-title">{module.name}</span>
            <span className="module-card-desc module-meta">{module.desc}</span>
            <span className="module-tag-list">
              {module.tags.map((tag) => (
                <span key={tag} className="module-tag">{tag}</span>
              ))}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
