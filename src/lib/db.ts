import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const dir = path.join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(path.join(dir, "game.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      run_value INTEGER NOT NULL,
      depth INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      run_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scores_user ON scores(user_id);
    CREATE INDEX IF NOT EXISTS idx_scores_value ON scores(run_value DESC);
  `);
  // v3 迁移：scores 增加 run_id 列（幂等提交 + 唯一索引，防重复上榜）
  const scoreCols = db.prepare("PRAGMA table_info(scores)").all() as Array<{ name: string }>;
  if (!scoreCols.some((col) => col.name === "run_id")) {
    db.exec("ALTER TABLE scores ADD COLUMN run_id TEXT;");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_run ON scores(user_id, run_id) WHERE run_id IS NOT NULL;");
  }
  return db;
}

export type UserRow = { id: number; username: string; password_hash: string; created_at: number };

export function findUserByUsername(username: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
}

export function findUserById(id: number): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function createUser(username: string, passwordHash: string): number {
  const info = getDb()
    .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)")
    .run(username, passwordHash, Date.now());
  return Number(info.lastInsertRowid);
}

export function insertSession(token: string, userId: number, expiresAt: number): void {
  getDb().prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    token, userId, Date.now(), expiresAt
  );
}

export function findSession(token: string): { user_id: number; expires_at: number } | undefined {
  return getDb().prepare("SELECT user_id, expires_at FROM sessions WHERE token = ?").get(token) as
    | { user_id: number; expires_at: number }
    | undefined;
}

export function deleteSession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function deleteExpiredSessions(): void {
  getDb().prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
}

export function updateUserPasswordHash(userId: number, passwordHash: string): void {
  getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
}

// 幂等提交：同一 run_id 只能提交一次；返回是否为新插入（false = 重复提交）
export function addScoreIdempotent(userId: number, runValue: number, depth: number, runId: string): boolean {
  const info = getDb()
    .prepare("INSERT OR IGNORE INTO scores (user_id, run_value, depth, created_at, run_id) VALUES (?, ?, ?, ?, ?)")
    .run(userId, Math.max(0, Math.round(runValue)), Math.max(0, Math.round(depth)), Date.now(), runId);
  return Number(info.changes) > 0;
}

// 限流：统计该用户最近 sinceMs 毫秒内的提交次数
export function countRecentScores(userId: number, sinceMs: number): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM scores WHERE user_id = ? AND created_at >= ?")
    .get(userId, sinceMs) as { n: number };
  return Number(row.n);
}

export function addScore(userId: number, runValue: number, depth: number): void {
  getDb().prepare("INSERT INTO scores (user_id, run_value, depth, created_at) VALUES (?, ?, ?, ?)").run(
    userId, Math.max(0, Math.round(runValue)), Math.max(0, Math.round(depth)), Date.now()
  );
}

export type LeaderboardEntry = {
  rank: number;
  username: string;
  best_value: number;
  best_depth: number;
  runs: number;
  last_run_at: number;
};

export function getLeaderboard(limit = 50): LeaderboardEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT u.username AS username,
              MAX(s.run_value) AS best_value,
              MAX(s.depth) AS best_depth,
              COUNT(*) AS runs,
              MAX(s.created_at) AS last_run_at
       FROM scores s JOIN users u ON u.id = s.user_id
       GROUP BY s.user_id
       ORDER BY best_value DESC, best_depth DESC
       LIMIT ?`
    )
    .all(limit) as Array<Omit<LeaderboardEntry, "rank">>;
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

export function getUserBest(userId: number): { best_value: number; best_depth: number; runs: number } {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(MAX(run_value),0) AS best_value,
              COALESCE(MAX(depth),0) AS best_depth,
              COUNT(*) AS runs
       FROM scores WHERE user_id = ?`
    )
    .get(userId) as { best_value: number; best_depth: number; runs: number };
  return row;
}
