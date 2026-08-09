import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type DbModule = typeof import("../src/lib/db");

let dbApi: DbModule;
let tempDir: string;
const originalDbPath = process.env.ABYSS_DB_PATH;

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "abyss-miner-save-"));
  process.env.ABYSS_DB_PATH = path.join(tempDir, "game.db");
  dbApi = await import("../src/lib/db");
  dbApi.getDb();
});

afterAll(() => {
  dbApi.getDb().close();
  if (originalDbPath === undefined) delete process.env.ABYSS_DB_PATH;
  else process.env.ABYSS_DB_PATH = originalDbPath;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("云存档 user_saves 表", () => {
  it("首次写入后可按用户读取", () => {
    const uid = dbApi.createUser("save-user-a", "hash");
    const saveJson = JSON.stringify({ version: 4, cash: 123, note: "甲" });
    dbApi.upsertUserSave(uid, saveJson, 1000);
    const row = dbApi.getUserSave(uid);
    expect(row?.save_json).toBe(saveJson);
    expect(row?.updated_at).toBe(1000);
  });

  it("重复写入覆盖（最后写入者胜）", () => {
    const uid = dbApi.createUser("save-user-b", "hash");
    dbApi.upsertUserSave(uid, JSON.stringify({ cash: 1 }), 2000);
    dbApi.upsertUserSave(uid, JSON.stringify({ cash: 2 }), 3000);
    const row = dbApi.getUserSave(uid);
    expect(row?.updated_at).toBe(3000);
    expect(JSON.parse(row!.save_json).cash).toBe(2);
  });

  it("不同用户存档相互隔离", () => {
    const a = dbApi.createUser("save-user-c1", "hash");
    const b = dbApi.createUser("save-user-c2", "hash");
    dbApi.upsertUserSave(a, JSON.stringify({ owner: "a" }), 1);
    const rowB = dbApi.getUserSave(b);
    expect(rowB).toBeUndefined();
    expect(JSON.parse(dbApi.getUserSave(a)!.save_json).owner).toBe("a");
  });

  it("未写入用户返回 undefined", () => {
    const uid = dbApi.createUser("save-user-d", "hash");
    expect(dbApi.getUserSave(uid)).toBeUndefined();
  });
});
