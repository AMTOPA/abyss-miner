"use client";

import { useEffect, useState } from "react";
import { fmt } from "@/game/config";
import { apiLeaderboard, type LeaderboardData, type LeaderboardRow, type ScoreKind } from "@/lib/api";

type Props = { onClose: () => void };

type Tab = {
  kind: ScoreKind;
  label: string;
  hint: string;
};

const TABS: Tab[] = [
  { kind: "value", label: "价值榜", hint: "按单次下矿入库价值排名" },
  { kind: "depth", label: "最深榜", hint: "按单次下矿到达深度排名" },
  { kind: "hardcore", label: "硬核榜", hint: "仅统计硬核模式的单次入库价值" },
  { kind: "net", label: "净收益榜", hint: "按单次下矿净收益排名" },
];

function displayBest(value: number, kind: ScoreKind): string {
  return kind === "depth" ? `${value}m` : fmt(value);
}

function displayTime(timestamp: number): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LeaderboardScreen({ onClose }: Props) {
  const [kind, setKind] = useState<ScoreKind>("value");
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);

    apiLeaderboard(50, kind)
      .then((next) => {
        if (active) setData(next);
      })
      .catch(() => {
        if (active) setError("排行榜加载失败，请稍后重试");
      });

    return () => {
      active = false;
    };
  }, [kind, reloadKey]);

  const currentTab = TABS.find((tab) => tab.kind === kind) ?? TABS[0];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal panel leaderboard-modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="modal-title">🏆 深渊排行榜</h2>
        <div className="modal-actions" role="tablist" aria-label="排行榜类型">
          {TABS.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              role="tab"
              aria-selected={kind === tab.kind}
              className={`btn ${kind === tab.kind ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setKind(tab.kind)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="modal-hint">{currentTab.hint}，登录后对应模式成绩自动上榜。娱乐榜：断局续玩/本地修改的成绩不参与排行，数值由服务器校验。</p>

        {error && (
          <div>
            <p className="submit-note bad">{error}</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setReloadKey((value) => value + 1)}>
                重试
              </button>
            </div>
          </div>
        )}
        {!data && !error && <p className="modal-hint">加载中…</p>}
        {data && (
          <>
            <LeaderboardTable data={data} kind={kind} />
            <LeaderboardCards data={data} kind={kind} />
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function LeaderboardTable({ data, kind }: { data: LeaderboardData; kind: ScoreKind }) {
  const meIsVisible = data.me ? data.list.some((row) => row.username === data.me?.username) : false;

  return (
    <div className="lb-wrap">
      <table className="lb-table">
        <thead>
          <tr>
            <th>排名</th>
            <th>矿工</th>
            <th>最佳</th>
            <th>深度</th>
            <th>局数</th>
            <th>最近时间</th>
          </tr>
        </thead>
        <tbody>
          {data.list.length === 0 && (
            <tr>
              <td colSpan={6} className="lb-empty">
                还没有人上榜，快去创造纪录吧！
              </td>
            </tr>
          )}
          {data.list.map((row) => (
            <LeaderboardTableRow key={row.username} row={row} kind={kind} isMe={row.username === data.me?.username} />
          ))}
        </tbody>
      </table>
      {data.me && data.me.runs > 0 && !meIsVisible && (
        <div className="lb-me-extra">
          你的最佳：{displayBest(data.me.best, kind)} · 深度 {data.me.best_depth}m · 共 {data.me.runs} 局
        </div>
      )}
    </div>
  );
}

function LeaderboardTableRow({ row, kind, isMe }: { row: LeaderboardRow; kind: ScoreKind; isMe: boolean }) {
  return (
    <tr className={isMe ? "lb-me" : ""}>
      <td className={row.rank <= 3 ? `lb-rank r${row.rank}` : ""}>
        {row.rank <= 3 ? ["🥇", "🥈", "🥉"][row.rank - 1] : row.rank}
      </td>
      <td className="lb-name">
        {row.username}
        {isMe && <span className="lb-tag">我</span>}
      </td>
      <td className="gold">{displayBest(row.best, kind)}</td>
      <td className="cyan">{row.best_depth}m</td>
      <td>{row.runs}</td>
      <td>{displayTime(row.last_run_at)}</td>
    </tr>
  );
}

// v9：移动端卡片化排行榜（≤600px 显示，桌面隐藏）
function LeaderboardCards({ data, kind }: { data: LeaderboardData; kind: ScoreKind }) {
  return (
    <div className="lb-card-list">
      {data.list.length === 0 && <p className="lb-empty lb-card-empty">还没有人上榜，快去创造纪录吧！</p>}
      {data.list.map((row) => (
        <div key={row.username} className={`lb-card ${row.username === data.me?.username ? "lb-card-me" : ""}`}>
          <span className={`lb-card-rank ${row.rank <= 3 ? `r${row.rank}` : ""}`}>
            {row.rank <= 3 ? ["🥇", "🥈", "🥉"][row.rank - 1] : row.rank}
          </span>
          <span className="lb-card-main">
            <span className="lb-card-name">
              {row.username}
              {row.username === data.me?.username && <span className="lb-tag">我</span>}
            </span>
            <span className="lb-card-meta">
              <span className="gold">{displayBest(row.best, kind)}</span>
              <span className="cyan">{row.best_depth}m</span>
              <span>{row.runs} 局</span>
            </span>
          </span>
          <span className="lb-card-time">{displayTime(row.last_run_at)}</span>
        </div>
      ))}
    </div>
  );
}
