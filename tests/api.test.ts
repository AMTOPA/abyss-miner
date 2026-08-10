import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

type DbModule = typeof import("../src/lib/db");

let dbApi: DbModule;
let tempDir: string;
const originalDbPath = process.env.ABYSS_DB_PATH;

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "abyss-miner-api-"));
  process.env.ABYSS_DB_PATH = path.join(tempDir, "game.db");

  // 先创建旧版结构，确保 getDb() 会执行增量迁移而不只是覆盖新建库场景。
  const legacyDb = new DatabaseSync(process.env.ABYSS_DB_PATH);
  legacyDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      run_value INTEGER NOT NULL,
      depth INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      run_id TEXT
    );
  `);
  legacyDb.close();

  dbApi = await import("../src/lib/db");
  dbApi.getDb();
});

afterAll(() => {
  dbApi.getDb().close();
  if (originalDbPath === undefined) delete process.env.ABYSS_DB_PATH;
  else process.env.ABYSS_DB_PATH = originalDbPath;
  rmSync(tempDir, { recursive: true, force: true });
});

function createTestUser(username: string): number {
  return dbApi.createUser(username, "test-password-hash");
}

describe("排行榜多榜数据库层", () => {
  it("为旧版 scores 表补齐 kind/net 列和 run_id 唯一索引", () => {
    const columns = dbApi.getDb().prepare("PRAGMA table_info(scores)").all() as Array<{ name: string }>;
    const indexes = dbApi.getDb().prepare("PRAGMA index_list(scores)").all() as Array<{ name: string; unique: number }>;

    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(["kind", "net", "run_id"]));
    expect(indexes).toEqual(expect.arrayContaining([expect.objectContaining({ name: "idx_scores_run_kind", unique: 1 })]));
  });

  it("按 kind 隔离记录，并按对应指标返回每用户最佳成绩", () => {
    const alice = createTestUser("kind-alice");
    const bob = createTestUser("kind-bob");

    dbApi.addScoreIdempotent(alice, 100, 50, "kind-alice-value-1", "value");
    dbApi.addScoreIdempotent(alice, 999, 900, "kind-alice-depth-1", "depth");
    dbApi.addScoreIdempotent(bob, 200, 30, "kind-bob-value-1", "value");

    const valueBoard = dbApi.getLeaderboard(50, "value");
    expect(valueBoard.map((row) => row.username)).toEqual(["kind-bob", "kind-alice"]);
    expect(valueBoard[0]).toMatchObject({ best: 200, best_value: 200, runs: 1 });

    const depthBoard = dbApi.getLeaderboard(50, "depth");
    expect(depthBoard).toHaveLength(1);
    expect(depthBoard[0]).toMatchObject({ username: "kind-alice", best: 900, best_depth: 900 });
  });

  it("同一 run_id 按 kind 幂等：同榜不重复，不同派生榜可各写一条", () => {
    const userId = createTestUser("idempotent-user");

    expect(dbApi.addScoreIdempotent(userId, 100, 10, "duplicate-run-id", "value")).toBe(true);
    // 同一 run_id 再次提交同榜：幂等返回 false（不重复插入）
    expect(dbApi.addScoreIdempotent(userId, 999, 99, "duplicate-run-id", "value")).toBe(false);
    // 同一 run_id 写派生榜（net/depth）：允许各写一条
    expect(dbApi.addScoreIdempotent(userId, 999, 99, "duplicate-run-id", "net", 500)).toBe(true);
    expect(dbApi.addScoreIdempotent(userId, 999, 99, "duplicate-run-id", "depth")).toBe(true);

    const count = dbApi.getDb().prepare("SELECT COUNT(*) AS n FROM scores WHERE user_id = ?").get(userId) as { n: number };
    expect(Number(count.n)).toBe(3);
  });

  it("限流计数只包含给定时间点之后的成功提交", () => {
    const userId = createTestUser("rate-user");
    const now = Date.now();

    dbApi.addScoreIdempotent(userId, 10, 1, "rate-recent-one", "value");
    dbApi.addScoreIdempotent(userId, 20, 2, "rate-recent-two", "value");
    dbApi.getDb()
      .prepare(
        `INSERT INTO scores (user_id, run_value, depth, created_at, run_id, kind, net)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(userId, 30, 3, now - 7_200_000, "rate-old-score", "value", 30);

    expect(dbApi.countRecentScores(userId, now - 60_000)).toBe(2);
    expect(dbApi.countRecentScores(userId, now - 10_800_000)).toBe(3);
  });

  it("净收益榜按 net 而不是 run_value 排序", () => {
    // 清空 scores，确保本测试只包含自己的两个用户（排行榜是全局查询）
    dbApi.getDb().prepare("DELETE FROM scores").run();
    const highValue = createTestUser("net-high-value");
    const highNet = createTestUser("net-high-net");

    dbApi.addScoreIdempotent(highValue, 10_000, 100, "net-high-value-run", "net", -50);
    dbApi.addScoreIdempotent(highNet, 100, 80, "net-high-net-run", "net", 500);

    const board = dbApi.getLeaderboard(50, "net");
    expect(board.map((row) => row.username)).toEqual(["net-high-net", "net-high-value"]);
    expect(board.map((row) => row.best)).toEqual([500, -50]);
    expect(dbApi.getUserBest(highNet, "net")).toMatchObject({ best: 500, best_net: 500, runs: 1 });
  });
});
