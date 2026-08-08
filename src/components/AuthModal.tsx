"use client";

import { useState } from "react";
import { apiLogin, apiRegister, AuthUser } from "@/lib/api";

type Props = {
  initialMode?: "login" | "register";
  onClose: () => void;
  onLogin: (user: AuthUser) => void;
};

export default function AuthModal({ initialMode = "login", onClose, onLogin }: Props) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "login"
          ? await apiLogin(username.trim(), password)
          : await apiRegister(username.trim(), password);
      onLogin(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal panel auth-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{mode === "login" ? "🔑 登录" : "✨ 注册矿工账号"}</h2>
        <div className="auth-tabs">
          <button className={`auth-tab ${mode === "login" ? "on" : ""}`} onClick={() => setMode("login")}>
            登录
          </button>
          <button className={`auth-tab ${mode === "register" ? "on" : ""}`} onClick={() => setMode("register")}>
            注册
          </button>
        </div>
        <form onSubmit={submit}>
          <label className="field">
            <span>用户名</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="2-16 位字母/数字/中文"
              autoComplete="username"
              maxLength={16}
            />
          </label>
          <label className="field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              maxLength={64}
            />
          </label>
          {error && <p className="submit-note bad">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "处理中…" : mode === "login" ? "登录" : "注册并登录"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
