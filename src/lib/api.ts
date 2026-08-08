export type AuthUser = { id: number; username: string };
export type LeaderboardRow = { rank: number; username: string; best_value: number; best_depth: number; runs: number; last_run_at: number };
export type LeaderboardData = { list: LeaderboardRow[]; me: { username: string; best_value: number; best_depth: number; runs: number } | null };

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "请求失败");
  return data;
}

export async function apiRegister(username: string, password: string): Promise<{ ok: true; user: AuthUser }> {
  return post("/api/auth/register", { username, password });
}

export async function apiLogin(username: string, password: string): Promise<{ ok: true; user: AuthUser }> {
  return post("/api/auth/login", { username, password });
}

export async function apiLogout(): Promise<void> {
  await post("/api/auth/logout");
}

export async function apiMe(): Promise<{ user: AuthUser | null }> {
  const res = await fetch("/api/auth/me");
  return res.json();
}

export async function apiLeaderboard(limit = 50): Promise<LeaderboardData> {
  const res = await fetch(`/api/leaderboard?limit=${limit}`);
  return res.json();
}

export async function apiSubmitScore(runValue: number, depth: number): Promise<{ ok: true; best: { best_value: number; best_depth: number; runs: number } }> {
  return post("/api/leaderboard", { runValue, depth });
}
