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
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scores_user ON scores(user_id);
    CREATE INDEX IF NOT EXISTS idx_scores_value ON scores(run_value DESC);
  `);
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
