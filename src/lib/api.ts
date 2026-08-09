export type AuthUser = { id: number; username: string };
export type ScoreKind = "value" | "depth" | "hardcore" | "net";
export type LeaderboardRow = {
  rank: number;
  username: string;
  best: number;
  best_value: number;
  best_depth: number;
  best_net: number;
  runs: number;
  last_run_at: number;
};
export type LeaderboardMe = Omit<LeaderboardRow, "rank">;
export type ScoreBest = Omit<LeaderboardMe, "username">;
export type LeaderboardData = { list: LeaderboardRow[]; me: LeaderboardMe | null };

async function readJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "请求失败");
  return data;
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return readJson<T>(res);
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
  return readJson(res);
}

export async function apiLeaderboard(limit = 50, kind: ScoreKind = "value"): Promise<LeaderboardData> {
  const params = new URLSearchParams({ limit: String(limit), kind });
  const res = await fetch(`/api/leaderboard?${params.toString()}`);
  return readJson(res);
}

export async function apiSubmitScore(
  runId: string,
  runValue: number,
  depth: number,
  kind: ScoreKind = "value",
  net?: number
): Promise<{ ok: true; best: ScoreBest }> {
  return post("/api/leaderboard", { runId, runValue, depth, kind, ...(net === undefined ? {} : { net }) });
}
