"use client";

import { ROOMS } from "@/game/content";
import type { RoomView } from "@/game/types";

type Props = {
  room: RoomView;
  onChoose: (optionId: string) => void;
};

// 特殊房间：标题与选项均以引擎快照为准，内容表只补充房间图标。
export default function RoomPanel({ room, onChoose }: Props) {
  const icon = ROOMS[room.id]?.icon ?? "🚪";
  return (
    <div className="panel v4-stage-panel room-panel">
      <div className="panel-title stage-panel-heading room-heading">
        <span className="room-icon">{icon}</span>
        <div>
          <span className="stage-panel-kicker">特殊房间</span>
          <h2 className="stage-panel-title">{room.title}</h2>
        </div>
      </div>
      <p className="stage-panel-desc room-desc">{room.desc}</p>
      {room.visited && <div className="room-visited-note">此处已被探索，剩余选项可能发生变化。</div>}
      <div className="room-option-list">
        {room.options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="room-card room-option"
            onClick={() => onChoose(option.id)}
          >
            <span className="room-option-icon">{option.icon}</span>
            <span className="room-option-copy">
              <span className="room-option-label room-title">{option.label}</span>
              <span className="room-option-desc room-meta">{option.desc}</span>
              {option.hint && <span className="room-option-hint">{option.hint}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
