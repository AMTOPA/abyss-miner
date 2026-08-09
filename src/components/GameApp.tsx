"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SaveData, loadSave, persistSave } from "@/game/config";
import { RunConfig, RunResult } from "@/game/types";
import { AudioEngine } from "@/game/audio";
import LobbyScreen from "./LobbyScreen";
import RunScreen from "./RunScreen";
import UpgradeScreen from "./UpgradeScreen";
import LeaderboardScreen from "./LeaderboardScreen";
import AuthModal from "./AuthModal";
import { apiLogout, apiMe, apiSubmitScore, AuthUser } from "@/lib/api";

type ScoreSubmit = { runId: string; value: number; depth: number };

export default function GameApp() {
  const [save, setSave] = useState<SaveData>(() => loadSave());
  const [inRun, setInRun] = useState(false);
  const [runStartDepth, setRunStartDepth] = useState(0);
  const [runConfig, setRunConfig] = useState<RunConfig | null>(null);
  const [showUpgrades, setShowUpgrades] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [muted, setMuted] = useState<boolean>(() => loadSave().settings.muted);
  const [pendingScore, setPendingScore] = useState<ScoreSubmit | null>(null);
  const [runId, setRunId] = useState<string>("");
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "done" | "needLogin" | "error">("idle");
  const [toast, setToast] = useState<string | null>(null);

  const audioRef = useRef<AudioEngine | null>(null);
  if (!audioRef.current) audioRef.current = new AudioEngine();

  // 避免 SSR 下读取 localStorage
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  useEffect(() => {
    const a = audioRef.current!;
    a.setMuted(muted);
    const s = loadSave();
    s.settings.muted = muted;
    persistSave(s);
    setSave(s);
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

  const startRun = useCallback((depth: number, config: RunConfig) => {
    setRunStartDepth(depth);
    setRunConfig(config);
    setSubmitState("idle");
    setPendingScore(null);
    // 每局唯一 run ID：用于排行榜幂等提交（同一局不会重复上榜）
    const rid =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "run_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
    setRunId(rid);
    setInRun(true);
    audioRef.current?.play("click");
  }, []);

  const handleRunEnd = useCallback(
    async (result: RunResult) => {
      setSave(result.save);
      if (result.kind === "surfaced" && result.banked > 0) {
        setPendingScore({ runId, value: result.banked, depth: result.depth });
        if (user) {
          setSubmitState("submitting");
          try {
            await apiSubmitScore(runId, result.banked, result.depth);
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
    [user, showToast, runId]
  );

  const handleLogin = useCallback(
    (u: AuthUser) => {
      setUser(u);
      setAuthOpen(false);
      showToast(`欢迎，${u.username}！`);
      // 登录成功后提交待处理成绩
      if (pendingScore) {
        setSubmitState("submitting");
        apiSubmitScore(pendingScore.runId, pendingScore.value, pendingScore.depth)
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

  const handleLogout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      /* ignore */
    }
    setUser(null);
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
          onRunEnd={handleRunEnd}
          onExit={() => {
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
          onToggleMute={() => setMuted((m) => !m)}
          onStart={startRun}
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
