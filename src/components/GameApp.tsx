"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SaveData, loadSave, persistSave, replaceSave, getLocalSaveUpdatedAt, normalizeSave, MUTED_KEY } from "@/game/config";
import { RunConfig, RunResult, RunStateSnapshot } from "@/game/types";
import { AudioEngine } from "@/game/audio";
import { dailyDateUTC, dailySeed } from "@/game/daily";
import LobbyScreen from "./LobbyScreen";
import RunScreen from "./RunScreen";
import UpgradeScreen from "./UpgradeScreen";
import LeaderboardScreen from "./LeaderboardScreen";
import AuthModal from "./AuthModal";
import { apiLogout, apiMe, apiSubmitScore, apiFetchSave, apiUploadSave, AuthUser } from "@/lib/api";

type ScoreSubmit = { runId: string; value: number; depth: number; net: number; difficulty: "mild" | "normal" | "hardcore"; dailyDay?: string };

// v9：断局续玩 —— 局内快照存 sessionStorage（关闭标签页即失效，不残留）
const RUN_SESSION_KEY = "abyss_miner_run_v9";
type RunSession = { snap: RunStateSnapshot; runId: string; runCost: number };

export default function GameApp() {
  const [save, setSave] = useState<SaveData>(() => loadSave());
  const [inRun, setInRun] = useState(false);
  const [runStartDepth, setRunStartDepth] = useState(0);
  const [runConfig, setRunConfig] = useState<RunConfig | null>(null);
  const [runCost, setRunCost] = useState(0); // v7：本局出发花费（净收益 = 入库价值 - 出发花费）
  const [showUpgrades, setShowUpgrades] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [muted, setMuted] = useState<boolean>(false);
  const [volume, setVolumeState] = useState<number>(1); // v8：主音量 0..1
  const [pendingScore, setPendingScore] = useState<ScoreSubmit | null>(null);
  const [runId, setRunId] = useState<string>("");
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "done" | "needLogin" | "error">("idle");
  const [toast, setToast] = useState<string | null>(null);
  const [resumeRun, setResumeRun] = useState<RunSession | null>(null);      // v9：可继续的远征
  const [resumeSnapshot, setResumeSnapshot] = useState<RunStateSnapshot | null>(null); // v9：传给 RunScreen

  const audioRef = useRef<AudioEngine | null>(null);
  const runIdRef = useRef("");
  const runCostRef = useRef(0);
  const dailyDayRef = useRef<string | null>(null); // v11: daily challenge day key
  if (!audioRef.current) audioRef.current = new AudioEngine();

  // 云存档同步：保存最新存档引用 + 上次已上传快照 + 并发锁
  const saveRef = useRef<SaveData>(save);
  const lastUploadedKeyRef = useRef<string | null>(null);
  const syncingRef = useRef(false);
  const cloudSyncedRef = useRef(false); // 云端拉取/合并完成前禁止上传，避免空存档覆盖云端

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // 避免 SSR 下读取 localStorage
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
    try {
      setMuted(window.localStorage.getItem(MUTED_KEY) === "1");
      // v9：恢复未完成的远征（仅稳定阶段、未结算的快照有效）
      const raw = window.sessionStorage.getItem(RUN_SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as RunSession;
        const s = parsed?.snap;
        if (
          s && s.version === 1 && s.config &&
          s.phase !== "idle" && s.phase !== "gameover" && s.phase !== "surfaced" && !s.runEnded
        ) {
          setResumeRun({ snap: s, runId: parsed.runId || "", runCost: Number(parsed.runCost) || 0 });
        } else {
          window.sessionStorage.removeItem(RUN_SESSION_KEY);
        }
      }
    } catch {
      window.sessionStorage.removeItem(RUN_SESSION_KEY);
    }
  }, []);

  useEffect(() => {
    audioRef.current?.setMuted(muted);
    try {
      window.localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [muted]);

  useEffect(() => {
    apiMe()
      .then((d) => d.user && setUser(d.user))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const showToast = useCallback((msg: string) => setToast(msg), []);
  // 登录后拉取云端存档：云端比本地新则覆盖本地；否则保留本地（稍后自动上传）
  useEffect(() => {
    if (!user) return;
    // v7：切换账号时重置同步门闩与已上传快照，防止旧账号/游客存档串号覆盖
    cloudSyncedRef.current = false;
    lastUploadedKeyRef.current = null;
    let cancelled = false;
    apiFetchSave()
      .then(({ save: cloud, updatedAt }) => {
        if (cancelled) return;
        if (cloud) {
          const localAt = getLocalSaveUpdatedAt();
          if ((updatedAt ?? 0) > localAt) {
            const merged = normalizeSave(cloud);
            replaceSave(merged);
            setSave(merged);
            showToast("已同步云端存档");
          }
        }
        // 拉取/合并完成，允许后续自动备份（避免在拉取完成前用空存档覆盖云端）
        cloudSyncedRef.current = true;
      })
      .catch(() => {
        // 拉取失败：保持禁止上传，避免覆盖云端
      });
    return () => {
      cancelled = true;
    };
  }, [user, showToast]);

  // 每 5 秒自动备份：已登录且存档有变化时上传到云端
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(async () => {
      if (syncingRef.current || !cloudSyncedRef.current) return;
      try {
        const s = saveRef.current;
        const key = JSON.stringify(s);
        if (key === lastUploadedKeyRef.current) return;
        syncingRef.current = true;
        await apiUploadSave(s, Date.now());
        lastUploadedKeyRef.current = key;
      } catch {
        // 网络/服务器异常：留待下个周期重试
      } finally {
        syncingRef.current = false;
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [user]);



  const startRun = useCallback((depth: number, config: RunConfig, cost = 0) => {
    setRunStartDepth(depth);
    setRunConfig(config);
    setRunCost(cost);
    runCostRef.current = cost;
    dailyDayRef.current = null;
    setSubmitState("idle");
    setPendingScore(null);
    setResumeSnapshot(null);
    setResumeRun(null);
    // 每局唯一 run ID：用于排行榜幂等提交（同一局不会重复上榜）
    const rid =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "run_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
    setRunId(rid);
    runIdRef.current = rid;
    setInRun(true);
    audioRef.current?.play("click");
  }, []);

  // v9：继续未完成的远征
  // v11????? ?? ?????? + ????????/??/??/???????????
  const startDailyChallenge = useCallback(() => {
    const day = dailyDateUTC();
    dailyDayRef.current = day;
    startRun(0, {
      difficulty: "normal",
      pocket: 0,
      buffs: [],
      equipment: [],
      items: [],
      archetype: null,
      seed: dailySeed(day),
      challenge: [],
      disasterMode: "gauge",
      dailyChallenge: true,
    }, 0);
  }, [startRun]);

  const startResume = useCallback(() => {
    if (!resumeRun) return;
    const { snap, runId: rid, runCost: cost } = resumeRun;
    dailyDayRef.current = snap.config.dailyChallenge && snap.config.seed.startsWith("daily-") ? snap.config.seed.slice(6) : null;
    setRunStartDepth(snap.depth);
    setRunConfig(snap.config);
    setRunCost(cost);
    runCostRef.current = cost;
    setRunId(rid);
    runIdRef.current = rid;
    setSave(snap.save);
    setSubmitState("idle");
    setPendingScore(null);
    setResumeSnapshot(snap);
    setInRun(true);
    audioRef.current?.play("click");
  }, [resumeRun]);

  // v9：RunScreen 每到一个稳定阶段把完整引擎状态写回 sessionStorage
  const handlePersistRunState = useCallback((snap: RunStateSnapshot) => {
    try {
      window.sessionStorage.setItem(RUN_SESSION_KEY, JSON.stringify({ snap, runId: runIdRef.current, runCost: runCostRef.current }));
    } catch {
      /* ignore quota errors */
    }
  }, []);

  const clearResume = useCallback(() => {
    try { window.sessionStorage.removeItem(RUN_SESSION_KEY); } catch { /* ignore */ }
    setResumeRun(null);
  }, []);

  const handleRunEnd = useCallback(
    async (result: RunResult) => {
      setSave(result.save);
      // v9：远征结束，清理续玩快照
      clearResume();
      if (result.kind === "surfaced" && result.banked > 0) {
        if (result.recovered) {
          // v9：断局续玩恢复的远征不上榜（防止重复提交/本地回滚作弊）
          setSubmitState("done");
          showToast("断局续玩，本局成绩不上榜");
          return;
        }
        // v7：一次提交写入全部派生榜（价值/最深/净收益，硬核另写硬核榜）
        const net = result.banked - runCost;
        const difficulty = result.difficulty;
        const dailyDay = dailyDayRef.current;
        setPendingScore({ runId, value: result.banked, depth: result.depth, net, difficulty, dailyDay: dailyDay ?? undefined });
        if (user) {
          setSubmitState("submitting");
          try {
            await apiSubmitScore(runId, result.banked, result.depth, { net, difficulty, dailyDay: dailyDay ?? undefined });
            setSubmitState("done");
            showToast("成绩已上榜！");
          } catch {
            setSubmitState("error");
            showToast("成绩提交失败，请稍后再试");
          }
        } else {
          setSubmitState("needLogin");
        }
      }
    },
    [user, showToast, runId, runCost, clearResume]
  );

  const handleLogin = useCallback(
    (u: AuthUser) => {
      setUser(u);
      setAuthOpen(false);
      showToast(`欢迎，${u.username}！`);
      // 登录成功不立即上传：先等云端拉取合并（云端更新则覆盖本地），合并完成后再由定时备份上传
      // 登录成功后提交待处理成绩
      if (pendingScore) {
        setSubmitState("submitting");
        apiSubmitScore(pendingScore.runId, pendingScore.value, pendingScore.depth, { net: pendingScore.net, difficulty: pendingScore.difficulty, dailyDay: pendingScore.dailyDay ?? undefined })
          .then(() => {
            setSubmitState("done");
            showToast("成绩已上榜！");
          })
          .catch(() => {
            setSubmitState("error");
            showToast("成绩提交失败");
          });
      }
    },
    [pendingScore, showToast]
  );

  const handleVolume = useCallback((v: number) => {
    setVolumeState(v);
    audioRef.current?.setVolume(v);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      // 退出前把当前存档上传一次，确保云端是最新状态
      await apiUploadSave(saveRef.current, Date.now()).catch(() => {});
      await apiLogout();
    } catch {
      /* ignore */
    }
    setUser(null);
    cloudSyncedRef.current = false;
    lastUploadedKeyRef.current = null;
    showToast("已退出登录");
  }, [showToast]);

  const openAuth = useCallback((mode: "login" | "register") => {
    setAuthMode(mode);
    setAuthOpen(true);
    audioRef.current?.play("click");
  }, []);

  if (!ready) {
    return (
      <main className="game-root">
        <div className="splash">
          <div className="splash-gem">💎</div>
          <div className="splash-text">深渊矿工</div>
        </div>
      </main>
    );
  }

  return (
    <main className="game-root">
      {inRun && runConfig ? (
        <RunScreen
          save={save}
          startDepth={runStartDepth}
          runConfig={runConfig}
          audio={audioRef.current!}
          user={user}
          muted={muted}
          submitState={submitState}
          onToggleMute={() => setMuted((m) => !m)}
          onOpenAuth={openAuth}
          resumeSnapshot={resumeSnapshot}
          onPersistRunState={handlePersistRunState}
          onRunEnd={handleRunEnd}
          onExit={() => {
            clearResume();
            setResumeSnapshot(null);
            setInRun(false);
            setRunConfig(null);
            setSave(loadSave());
            audioRef.current?.play("click");
          }}
        />
      ) : (
        <LobbyScreen
          save={save}
          user={user}
          muted={muted}
          volume={volume}
          onVolume={handleVolume}
          onToggleMute={() => setMuted((m) => !m)}
          onStart={startRun}
          onDailyChallenge={startDailyChallenge}
          resumeRun={resumeRun ? { depth: resumeRun.snap.depth, pocket: resumeRun.snap.pocket } : null}
          onResume={startResume}
          onAbandonResume={clearResume}
          onUpgrades={() => {
            setShowUpgrades(true);
            audioRef.current?.play("click");
          }}
          onLeaderboard={() => {
            setShowLeaderboard(true);
            audioRef.current?.play("click");
          }}
          onLogin={() => openAuth("login")}
          onRegister={() => openAuth("register")}
          onLogout={handleLogout}
          onSave={(next) => {
            setSave(next);
            persistSave(next);
          }}
        />
      )}

      {showUpgrades && (
        <UpgradeScreen
          save={save}
          onBuy={(next) => {
            setSave(next);
            audioRef.current?.play("click");
          }}
          onClose={() => setShowUpgrades(false)}
        />
      )}

      {showLeaderboard && <LeaderboardScreen onClose={() => setShowLeaderboard(false)} />}

      {authOpen && <AuthModal initialMode={authMode} onClose={() => setAuthOpen(false)} onLogin={handleLogin} />}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
