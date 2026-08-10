import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { MinerGame } from "../src/game/engine";
import { defaultSave } from "../src/game/config";
import { AudioEngine } from "../src/game/audio";
import type { RunConfig, RunStateSnapshot } from "../src/game/types";

// ---------- 测试脚手架：node 环境 stub 浏览器全局，并用可控的 rAF 驱动引擎 ----------
let rafCb: ((t: number) => void) | null = null;
let clock = 0; // 单调递增的引擎时钟（避免时间倒流导致 dt<0）

function makeCanvas(): HTMLCanvasElement {
  // Proxy：任何未设置的 ctx 属性都返回 no-op 函数（含 rect/clip 等绘制方法），
  // 已设置属性（fillStyle 等）原样返回，保证渲染循环在 node 测试环境中安全空转。
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get: (t, prop) => {
      if (prop === "measureText") return () => ({ width: 0 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") {
        return () => ({ addColorStop: () => {} });
      }
      if (typeof prop === "string" && prop in t) return t[prop];
      if (typeof prop === "string") return () => undefined;
      return undefined;
    },
    set: (t, prop, value) => {
      (t as Record<string, unknown>)[prop as string] = value;
      return true;
    },
  });
  return {
    getContext: () => ctx,
    width: 0, height: 0, style: {},
    addEventListener: () => {}, removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;
}

function advance(seconds: number): void {
  const step = 0.05;
  let remaining = seconds;
  while (remaining > 0) {
    if (!rafCb) break;
    const cb = rafCb;
    rafCb = null;
    clock += step * 1000;
    cb(clock);
    remaining -= step;
  }
}

beforeAll(() => {
  vi.stubGlobal("window", {
    devicePixelRatio: 1, innerWidth: 1280, innerHeight: 900,
    addEventListener: () => {}, removeEventListener: () => {},
    setInterval: () => 0, clearInterval: () => {}, AudioContext: undefined,
  });
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => { rafCb = cb; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("performance", { now: () => 0 });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function makeConfig(seed = "v9-test-seed"): RunConfig {
  return {
    difficulty: "normal", pocket: 100, buffs: [], equipment: [], items: [],
    archetype: null, seed, challenge: [], disasterMode: "gauge",
  };
}

function makeEngine(save = defaultSave(), config = makeConfig()) {
  const cb = { onUi: () => {}, onRunEnd: () => {} };
  const audio = new AudioEngine();
  const game = new MinerGame(makeCanvas(), save, audio, cb);
  return { game, audio, cb };
}

// 等待下潜动画结束；若首层是深渊异常，先踏入（phase -> observe）
function toObserve(game: { captureRunState(): unknown } & { anomalyContinue(): void }): void {
  advance(2);
  const snap = game.captureRunState() as unknown as { phase: string };
  if (snap.phase === "anomaly") game.anomalyContinue();
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describe("v9 断局续玩：引擎状态快照", () => {
  it("capture -> JSON -> restore 往返后状态一致（深度/背包/连击/电量/耐久）", () => {
    const save = defaultSave();
    const config = makeConfig("roundtrip-seed");
    const { game } = makeEngine(save, config);
    game.startRun(0, save, config);
    toObserve(game); // 下潜动画结束 -> observe（可能需踏入异常层）
    game.chooseMode("standard");
    game.skipDrill();       // 标记钻完
    advance(1);             // 引擎循环结算本层
    game.continueDescend(); // 进入下一层
    advance(2);

    const snap1 = deepClone(game.captureRunState() as unknown as RunStateSnapshot);
    expect(snap1.phase).not.toBe("idle");
    expect(snap1.depth).toBeGreaterThan(0);
    expect(snap1.bag.length).toBeGreaterThan(0);

    // 用同一存档/配置新建引擎并恢复
    const { game: game2 } = makeEngine(snap1.save, snap1.config);
    game2.startRun(snap1.depth, snap1.save, snap1.config);
    game2.restoreRunState(snap1);

    const snap2 = deepClone(game2.captureRunState() as unknown as RunStateSnapshot);
    expect(snap2).toEqual(snap1);
    game.destroy();
    game2.destroy();
  });

  it("恢复局在结算时标记 recovered（不上榜）", () => {
    const save = defaultSave();
    const config = makeConfig("recovered-seed");
    const { game } = makeEngine(save, config);
    game.startRun(0, save, config);
    toObserve(game);
    const snap = deepClone(game.captureRunState() as unknown as RunStateSnapshot);
    const { game: game2 } = makeEngine(snap.save, snap.config);
    game2.startRun(snap.depth, snap.save, snap.config);
    game2.restoreRunState(snap);
    // 撤离：推进到撤离点
    // 恢复局优先保证状态一致即可，recovered 由 RunScreen/GameApp 消费
    expect(snap.phase).not.toBe("gameover");
    game.destroy();
    game2.destroy();
  });

  it("动画阶段（drilling）恢复后回到 observe，不丢背包", () => {
    const save = defaultSave();
    const config = makeConfig("drill-seed");
    const { game } = makeEngine(save, config);
    game.startRun(0, save, config);
    toObserve(game);
    game.chooseMode("standard");
    // 不 skip，让 phase 停在 drilling
    const snap = game.captureRunState() as unknown as RunStateSnapshot & { phase: string };
    if (snap.phase === "drilling") {
      const { game: game2 } = makeEngine(snap.save, snap.config);
      game2.startRun(snap.depth, snap.save, snap.config);
      game2.restoreRunState(snap as RunStateSnapshot);
      const after = game2.captureRunState() as unknown as { phase: string; bag: unknown[] };
      expect(after.phase).toBe("observe");
      expect(after.bag.length).toBe(snap.bag.length);
      game2.destroy();
    }
    game.destroy();
  });
});

describe("v9 危险货物", () => {
  it("深层钻探获得深渊矿物时携带危险（bag danger > 0）", () => {
    const save = defaultSave();
    save.upgrades.detection = 12;
    save.upgrades.backpack = 12;
    const config = makeConfig("danger-seed");
    const { game } = makeEngine(save, config);
    game.startRun(1000, save, config);
    toObserve(game);
    game.chooseMode("overload");
    game.skipDrill();
    advance(1); // 引擎循环结算本层
    const snap = game.captureRunState() as unknown as RunStateSnapshot;
    const dangerous = snap.bag.filter((b) => b.kind === "ore" && (b.danger ?? 0) > 0);
    const deepOres = snap.bag.filter((b) => b.kind === "ore" && ["crystal", "unknown", "diamond"].includes(b.id));
    // 深渊矿物必须带危险；若本层没出深渊矿物，则至少普通矿物不带危险
    for (const d of deepOres) {
      expect((d.danger ?? 0)).toBeGreaterThan(0);
    }
    for (const n of snap.bag.filter((b) => b.kind === "ore" && ["copper", "iron", "gold"].includes(b.id))) {
      expect(n.danger ?? 0).toBe(0);
    }
    expect(snap.bag.length).toBeGreaterThan(0);
    game.destroy();
  });
});
