import { describe, it, expect } from "vitest";
import { defaultSave, normalizeSave } from "../src/game/config";
import { ACHIEVEMENTS, claimAchievement, completedUnclaimed } from "../src/game/achievements";
import { dailyDateUTC, dailyKey, dailySeed, isDailyRunId } from "../src/game/daily";
import type { SaveData } from "../src/game/config";

describe("v11 ??????", () => {
  it("????????????????", () => {
    const s1 = dailySeed("2026-08-10");
    const s2 = dailySeed("2026-08-10");
    const s3 = dailySeed("2026-08-11");
    expect(s1).toBe(s2);
    expect(s1).not.toBe(s3);
    expect(dailyKey("2026-08-10")).toBe("daily-2026-08-10");
    expect(isDailyRunId("daily-2026-08-10-abc")).toBe(true);
    expect(isDailyRunId("run_abc")).toBe(false);
  });

  it("dailyDateUTC ?? YYYY-MM-DD ????????", () => {
    const d = new Date("2026-08-10T12:00:00Z");
    expect(dailyDateUTC(d)).toBe("2026-08-10");
  });
});

describe("v11 ????", () => {
  it("?????????????????", () => {
    let save: SaveData = { ...defaultSave(), cash: 100 };
    // ????first_run ?? runs>=1
    expect(completedUnclaimed(save)).toHaveLength(0);
    const untouched = claimAchievement(save, "first_run");
    expect(untouched).toBe(save); // ????????
    expect(untouched.cash).toBe(100);

    // ?? first_run
    save = { ...save, stats: { ...save.stats, runs: 1 } };
    const unclaimed = completedUnclaimed(save).map((a) => a.id);
    expect(unclaimed).toContain("first_run");

    const claimed1 = claimAchievement(save, "first_run");
    expect(claimed1.cash).toBe(100 + (ACHIEVEMENTS.find((a) => a.id === "first_run")?.reward ?? 0));
    expect(claimed1.achievements).toContain("first_run");

    // ??????????
    const claimed2 = claimAchievement(claimed1, "first_run");
    expect(claimed2.cash).toBe(claimed1.cash);
    expect(claimed2.achievements.filter((x) => x === "first_run")).toHaveLength(1);
  });

  it("deep ????????bestDepth?", () => {
    const save: SaveData = { ...defaultSave(), stats: { ...defaultSave().stats, bestDepth: 300 } };
    const done = new Set(completedUnclaimed(save).map((a) => a.id));
    expect(done.has("depth_100")).toBe(true);
    expect(done.has("depth_300")).toBe(true);
    expect(done.has("depth_600")).toBe(false);
  });

  it("normalizeSave ??? achievements ??", () => {
    const s = normalizeSave({ ...defaultSave(), achievements: ["first_run", 42, "runs_10"] } as unknown);
    expect(s.achievements).toEqual(["first_run", "runs_10"]);
  });
});
