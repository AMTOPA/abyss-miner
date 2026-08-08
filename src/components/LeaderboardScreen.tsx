"use client";

import { useEffect, useState } from "react";
import { fmt } from "@/game/config";
import { apiLeaderboard, LeaderboardData } from "@/lib/api";

type Props = { onClose: () => void };

export default function LeaderboardScreen({ onClose }: Props) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiLeaderboard(50)
      .then(setData)
      .catch(() => setError("排行榜加载失败"));
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal panel leaderboard-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">🏆 深渊排行榜</h2>
        <p className="modal-hint">按「单次下矿最高入库价值」排名，登录后成绩自动上榜</p>
        {error && <p className="submit-note bad">{error}</p>}
        {!data && !error && <p className="modal-hint">加载中…</p>}
        {data && (
          <div className="lb-wrap">
            <table className="lb-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>矿工</th>
                  <th>最佳单次</th>
                  <th>最深</th>
                  <th>次数</th>
                </tr>
              </thead>
              <tbody>
                {data.list.length === 0 && (
                  <tr>
                    <td colSpan={5} className="lb-empty">
                      还没有人上榜，快去创造纪录吧！
                    </td>
                  </tr>
                )}
                {data.list.map((row) => {
                  const isMe = data.me && row.username === data.me.username;
                  return (
                    <tr key={row.username} className={isMe ? "lb-me" : ""}>
                      <td className={row.rank <= 3 ? `lb-rank r${row.rank}` : ""}>
                        {row.rank <= 3 ? ["🥇", "🥈", "🥉"][row.rank - 1] : row.rank}
                      </td>
                      <td className="lb-name">
                        {row.username}
                        {isMe && <span className="lb-tag">我</span>}
                      </td>
                      <td className="gold">{fmt(row.best_value)}</td>
                      <td className="cyan">{row.best_depth}m</td>
                      <td>{row.runs}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data.me && data.list.length > 0 && !data.list.some((r) => r.username === (data.me as { username: string }).username) && (
              <div className="lb-me-extra">
                你的最佳：{fmt(data.me.best_value)} · 最深 {data.me.best_depth}m
              </div>
            )}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
