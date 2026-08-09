"use client";

import { ORES } from "@/game/config";
import { ORE_QUALITIES } from "@/game/items";
import type { ForwardBaseView } from "@/game/types";

type Props = {
  base: ForwardBaseView;
  onChoose: (optionId: string) => void;
};

// 前进营地：首次交付材料建造，之后显示补给方向。
export default function BasePanel({ base, onChoose }: Props) {
  const need = base.needOre;
  const ore = need ? ORES[need.id as keyof typeof ORES] : null;
  const quality = need ? ORE_QUALITIES[need.quality] : null;

  return (
    <div className="panel v4-stage-panel base-panel">
      <div className="panel-title stage-panel-heading">
        <span className="stage-panel-kicker">{base.depth}m 前进营地</span>
        <h2 className="stage-panel-title">{base.built ? "营地已启用" : "建立检查点"}</h2>
        <p className="stage-panel-desc">
          {base.built ? "选择一次营地服务，为下一段深潜做准备。" : "交付指定矿石，将这里改造成永久前进营地。"}
        </p>
      </div>

      {!base.built ? (
        <div className="base-card base-build-card">
          <div className="base-status-badge base-status base-status-unbuilt">未建成</div>
          {need ? (
            <div className="base-ore-requirement">
              <span className="base-ore-icon">{quality?.icon ?? "🪨"}</span>
              <span className="base-ore-copy">
                <strong>{ore?.name ?? need.id} · {quality?.name ?? need.quality}</strong>
                <span>需要 {need.count} 个</span>
              </span>
            </div>
          ) : (
            <p className="modal-hint">材料要求正在同步，请稍后再试。</p>
          )}
          <button type="button" className="btn btn-primary btn-big" disabled={!need} onClick={() => onChoose("build")}>
            📦 交付材料
          </button>
        </div>
      ) : (
        <>
          <div className="base-status-badge base-status base-status-built">已建成</div>
          <div className="base-option-grid">
            {base.options.map((option) => (
              <button key={option.id} type="button" className="base-card base-option" onClick={() => onChoose(option.id)}>
                <span className="base-option-icon">{option.icon}</span>
                <span className="base-option-label base-title">{option.label}</span>
                <span className="base-option-desc base-meta">{option.desc}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
