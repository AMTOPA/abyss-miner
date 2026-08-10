"use client";

import { ACHIEVEMENTS, achievementProgress, claimAchievement } from "@/game/achievements";
import { fmt, type SaveData } from "@/game/config";

type Props = { save: SaveData; onSave: (next: SaveData) => void };

// v11????? ?? ???????????????
export default function AchievementsPanel({ save, onSave }: Props) {
  const claimed = new Set(save.achievements ?? []);
  const claimedCount = claimed.size;
  return (
    <div className="ach-panel">
      <div className="ach-summary">
        ?? 已领取 <strong className="gold">{claimedCount}</strong>/{ACHIEVEMENTS.length} ? ????????领取?????
      </div>
      <div className="ach-grid">
        {ACHIEVEMENTS.map((a) => {
          const done = a.progress(save) >= a.target;
          const isClaimed = claimed.has(a.id);
          const cur = achievementProgress(save, a);
          const pct = Math.min(100, Math.round((cur / a.target) * 100));
          return (
            <div key={a.id} className={`ach-card${done ? " done" : ""}${isClaimed ? " claimed" : ""}`}>
              <span className="ach-icon">{a.icon}</span>
              <span className="ach-info">
                <strong>{a.name}</strong>
                <small>{a.desc}</small>
                <span className="ach-progress"><span className="ach-progress-fill" style={{ width: `${pct}%` }} /></span>
                <span className="ach-meta">{fmt(cur)}/{fmt(a.target)} ? 奖励 {fmt(a.reward)} ??</span>
              </span>
              {isClaimed ? (
                <span className="ach-claimed-tag">? 已领取</span>
              ) : done ? (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => onSave(claimAchievement(save, a.id))}>领取</button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
