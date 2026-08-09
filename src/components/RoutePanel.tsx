"use client";

import type { RouteChoice, RouteId } from "@/game/types";

type Props = {
  routes: RouteChoice[];
  onChoose: (id: RouteId) => void;
};

// 节点分岔：只消费快照中的路线描述，不依赖引擎内部实现。
export default function RoutePanel({ routes, onChoose }: Props) {
  return (
    <div className="panel v4-stage-panel route-panel">
      <div className="panel-title stage-panel-heading">
        <span className="stage-panel-kicker">路径决策</span>
        <h2 className="stage-panel-title">选择下一条矿道</h2>
        <p className="stage-panel-desc">不同路线会改变后续节点的风险与收益倾向。</p>
      </div>
      <div className="route-card-grid">
        {routes.map((route) => (
          <button
            key={route.id}
            type="button"
            className={`route-card route-${route.id}`} data-route={route.id}
            onClick={() => onChoose(route.id)}
          >
            <span className="route-card-icon">{route.icon}</span>
            <span className="route-card-name route-title">{route.name}</span>
            <span className="route-card-desc route-meta">{route.desc}</span>
            <span className="route-card-meta route-meta">
              <span className="route-risk-label">风险 · {route.riskLabel}</span>
              <span className="route-reward-label">收益 · {route.rewardLabel}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
